import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// request logs, one row per api call. only the names of the query params and
// body fields are stored, never their values. data/usage.db is seeded demo data

export type Customer = {
  id: string;
  name: string;
  plan: string;
  ownerName: string;
  ownerEmail: string;
};

export type Caller = {
  customerId: string;
  customer: string;
  plan: string;
  owner: string;
  requests: number;
  firstSeen: string;
  lastSeen: string;
  clients: Record<string, number>;
  queryParams: Record<string, number>;
  bodyFields: Record<string, number>;
};

export type LoggedRequest = {
  requestedAt: string;
  status: number;
  client: string;
  queryParams: string[];
  bodyFields: string[];
};

let db: DatabaseSync | undefined;

function database(): DatabaseSync {
  if (!db) {
    const file = process.env.USAGE_DB_PATH ?? path.join(process.cwd(), "data/usage.db");
    if (!existsSync(file)) throw new Error(`no request logs at ${file}, run \`npm run seed\` and restart \`npm run dev\``);
    db = new DatabaseSync(file, { readOnly: true });
  }
  return db;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export function findCallers(method: string, route: string, days: number): Caller[] {
  const since = daysAgo(days);

  const totals = database()
    .prepare(
      `SELECT c.id, c.name, c.plan, c.owner_name, COUNT(*) AS requests,
              MIN(r.requested_at) AS first_seen, MAX(r.requested_at) AS last_seen
         FROM api_requests r JOIN customers c ON c.id = r.customer_id
        WHERE r.method = ? AND r.route = ? AND r.requested_at >= ?
        GROUP BY c.id
        ORDER BY requests DESC`
    )
    .all(method, route, since) as {
    id: string;
    name: string;
    plan: string;
    owner_name: string;
    requests: number;
    first_seen: string;
    last_seen: string;
  }[];

  const usage = database()
    .prepare(
      `SELECT customer_id, 'client' AS kind, client AS name, COUNT(*) AS uses
         FROM api_requests WHERE method = ? AND route = ? AND requested_at >= ?
        GROUP BY customer_id, client
       UNION ALL
       SELECT customer_id, 'query', p.value, COUNT(*)
         FROM api_requests, json_each(query_params) p WHERE method = ? AND route = ? AND requested_at >= ?
        GROUP BY customer_id, p.value
       UNION ALL
       SELECT customer_id, 'body', f.value, COUNT(*)
         FROM api_requests, json_each(body_fields) f WHERE method = ? AND route = ? AND requested_at >= ?
        GROUP BY customer_id, f.value`
    )
    .all(method, route, since, method, route, since, method, route, since) as {
    customer_id: string;
    kind: "client" | "query" | "body";
    name: string;
    uses: number;
  }[];

  return totals.map((row) => {
    const mine = usage.filter((u) => u.customer_id === row.id);
    const count = (kind: string) => Object.fromEntries(mine.filter((u) => u.kind === kind).map((u) => [u.name, u.uses]));
    return {
      customerId: row.id,
      customer: row.name,
      plan: row.plan,
      owner: row.owner_name,
      requests: row.requests,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      clients: count("client"),
      queryParams: count("query"),
      bodyFields: count("body"),
    };
  });
}

export function recentRequests(customerId: string, method: string, route: string, limit: number): LoggedRequest[] {
  const rows = database()
    .prepare(
      `SELECT requested_at, status, client, query_params, body_fields
         FROM api_requests
        WHERE customer_id = ? AND method = ? AND route = ?
        ORDER BY requested_at DESC
        LIMIT ?`
    )
    .all(customerId, method, route, limit) as {
    requested_at: string;
    status: number;
    client: string;
    query_params: string;
    body_fields: string;
  }[];

  return rows.map((row) => ({
    requestedAt: row.requested_at,
    status: row.status,
    client: row.client,
    queryParams: JSON.parse(row.query_params) as string[],
    bodyFields: JSON.parse(row.body_fields) as string[],
  }));
}

export function getCustomer(id: string): Customer | undefined {
  const row = database()
    .prepare(`SELECT id, name, plan, owner_name, owner_email FROM customers WHERE id = ?`)
    .get(id) as { id: string; name: string; plan: string; owner_name: string; owner_email: string } | undefined;

  return row && { id: row.id, name: row.name, plan: row.plan, ownerName: row.owner_name, ownerEmail: row.owner_email };
}
