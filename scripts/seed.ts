// seeds data/usage.db with six customers and 90 days of calls ending now.
// rerun it whenever the timestamps get stale
import { mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Call = {
  method: string;
  route: string;
  perDay: number;
  query?: Record<string, number>;
  body?: Record<string, number>;
  // limits the call to a slice of the 90 days, counted back from today
  fromDaysAgo?: number;
  toDaysAgo?: number;
};

type SeedCustomer = {
  id: string;
  name: string;
  plan: string;
  ownerName: string;
  ownerEmail: string;
  client: string;
  calls: Call[];
};

const DAYS = 90;

// query/body odds are the share of calls that send each one
const customers: SeedCustomer[] = [
  {
    id: "cus_harborpine",
    name: "Harbor & Pine Podcasts",
    plan: "scale",
    ownerName: "Dana Whitfield",
    ownerEmail: "delivered+harborpine@resend.dev",
    client: "murmurly-node/3.2.0",
    calls: [
      { method: "POST", route: "/v1/transcripts", perDay: 22, body: { audio_url: 1, webhook_url: 1, speaker_labels: 0.96, language: 0.1 } },
      { method: "GET", route: "/v1/transcripts/{id}", perDay: 22 },
      { method: "GET", route: "/v1/transcripts/{id}/words", perDay: 20 },
      { method: "GET", route: "/v1/transcripts", perDay: 3, query: { limit: 1 } },
    ],
  },
  {
    id: "cus_quarrylane",
    name: "Quarry Lane Legal",
    plan: "growth",
    ownerName: "Sam Adeyemi",
    ownerEmail: "delivered+quarrylane@resend.dev",
    client: "murmurly-python/1.8.4",
    calls: [
      { method: "POST", route: "/v1/transcripts", perDay: 10, body: { audio_url: 1, language: 1 } },
      { method: "GET", route: "/v1/transcripts", perDay: 21, query: { page: 1, limit: 1, status: 0.6 } },
      { method: "GET", route: "/v1/transcripts/{id}", perDay: 10 },
    ],
  },
  {
    id: "cus_kestrel",
    name: "Kestrel Call Analytics",
    plan: "scale",
    ownerName: "Ines Moreau",
    ownerEmail: "delivered+kestrel@resend.dev",
    client: "python-requests/2.32.3",
    calls: [
      { method: "POST", route: "/v1/transcripts", perDay: 42, body: { audio_url: 1, speaker_labels: 1, webhook_url: 1 } },
      { method: "GET", route: "/v1/transcripts/{id}", perDay: 42 },
      { method: "DELETE", route: "/v1/transcripts/{id}", perDay: 40 },
    ],
  },
  {
    id: "cus_bluebird",
    name: "Bluebird Classrooms",
    plan: "starter",
    ownerName: "Theo Lindqvist",
    ownerEmail: "delivered+bluebird@resend.dev",
    client: "murmurly-node/3.1.0",
    calls: [
      { method: "POST", route: "/v1/transcripts", perDay: 6, body: { audio_url: 1, language: 1 } },
      { method: "GET", route: "/v1/transcripts/{id}", perDay: 6 },
      { method: "GET", route: "/v1/transcripts", perDay: 2, query: { limit: 1 } },
    ],
  },
  {
    id: "cus_saltmarsh",
    name: "Saltmarsh Media",
    plan: "growth",
    ownerName: "Ruth Bamidele",
    ownerEmail: "delivered+saltmarsh@resend.dev",
    client: "murmurly-node/2.9.1",
    calls: [
      { method: "POST", route: "/v1/transcripts", perDay: 8, body: { audio_url: 1 } },
      { method: "GET", route: "/v1/transcripts/{id}", perDay: 8 },
      // stopped calling /words about seven weeks ago
      { method: "GET", route: "/v1/transcripts/{id}/words", perDay: 7, fromDaysAgo: 90, toDaysAgo: 47 },
    ],
  },
  {
    id: "cus_orchard",
    name: "Orchard Street Labs",
    plan: "starter",
    ownerName: "Mo Haddad",
    ownerEmail: "delivered+orchard@resend.dev",
    client: "curl/8.7.1",
    calls: [
      { method: "POST", route: "/v1/transcripts", perDay: 3, body: { audio_url: 1 } },
      { method: "GET", route: "/v1/transcripts", perDay: 4, query: { limit: 1, status: 0.5 } },
    ],
  },
];

// fixed seed so the counts come out the same every time
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261119);

const pick = (odds: Record<string, number> = {}) => Object.keys(odds).filter((name) => random() < odds[name]!);
const statusFor = (method: string) => {
  const roll = random();
  if (roll < 0.004) return 500;
  if (roll < 0.02) return method === "POST" ? 422 : 404;
  return method === "POST" ? 201 : method === "DELETE" ? 204 : 200;
};

const dbPath = "data/usage.db";
mkdirSync("data", { recursive: true });
rmSync(dbPath, { force: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    owner_email TEXT NOT NULL
  );
  CREATE TABLE api_requests (
    id INTEGER PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    query_params TEXT NOT NULL,
    body_fields TEXT NOT NULL,
    status INTEGER NOT NULL,
    client TEXT NOT NULL,
    requested_at TEXT NOT NULL
  );
  CREATE INDEX api_requests_route ON api_requests (method, route, requested_at);
  CREATE INDEX api_requests_customer ON api_requests (customer_id, method, route, requested_at);
`);

const insertCustomer = db.prepare(`INSERT INTO customers VALUES (?, ?, ?, ?, ?)`);
const insertRequest = db.prepare(
  `INSERT INTO api_requests (customer_id, method, route, query_params, body_fields, status, client, requested_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const now = Date.now();
let total = 0;

db.exec("BEGIN");
for (const customer of customers) {
  insertCustomer.run(customer.id, customer.name, customer.plan, customer.ownerName, customer.ownerEmail);

  for (const call of customer.calls) {
    const from = call.fromDaysAgo ?? DAYS;
    const to = call.toDaysAgo ?? 0;

    for (let day = from; day > to; day--) {
      // some day-to-day wobble around the average
      const count = Math.max(0, Math.round(call.perDay * (0.75 + random() * 0.5)));
      for (let i = 0; i < count; i++) {
        const at = new Date(now - (day - random()) * 86_400_000).toISOString();
        insertRequest.run(
          customer.id,
          call.method,
          call.route,
          JSON.stringify(pick(call.query)),
          JSON.stringify(pick(call.body)),
          statusFor(call.method),
          customer.client,
          at
        );
        total++;
      }
    }
  }
}
db.exec("COMMIT");
db.exec("VACUUM");
db.close();

console.log(`Wrote ${total.toLocaleString("en-US")} requests from ${customers.length} customers to ${dbPath}`);
