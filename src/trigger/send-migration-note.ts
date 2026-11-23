import { AbortTaskRunError, schemaTask } from "@trigger.dev/sdk";
import { Resend } from "resend";
import { z } from "zod";
import { config, requireEnv } from "../lib/config";
import { getCustomer } from "../lib/usage";

let resend: Resend | undefined;

// one email per run so a failed send retries on its own
export const sendMigrationNote = schemaTask({
  id: "send-migration-note",
  schema: z.object({
    customerId: z.string(),
    subject: z.string(),
    body: z.string(),
    guideUrl: z.string().url(),
    // e.g. "acme/api#42", part of the resend idempotency key
    change: z.string(),
  }),
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 60_000 },
  run: async ({ customerId, subject, body, guideUrl, change }) => {
    // the address comes from our own records at send time, never from the model or the payload
    const customer = getCustomer(customerId);
    if (!customer) throw new AbortTaskRunError(`no customer with id ${customerId}`);

    resend ??= new Resend(requireEnv("RESEND_API_KEY"));
    const { data, error } = await resend.emails.send(
      {
        from: config.emailFrom,
        to: customer.ownerEmail,
        subject,
        text: `${body}\n\nThe migration guide has the details: ${guideUrl}\n\nThe Murmurly API team`,
      },
      { idempotencyKey: `migration-note/${change}/${customerId}` }
    );
    if (error) {
      const message = `resend rejected the note to ${customer.name}: ${error.message}`;
      // rate limits and 5xx are worth retrying, a bad address or key isn't
      const retryable = error.name === "rate_limit_exceeded" || (error.statusCode ?? 500) >= 500;
      throw retryable ? new Error(message) : new AbortTaskRunError(message);
    }

    return { emailId: data.id, customer: customer.name };
  },
});
