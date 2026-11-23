export const config = {
  specPath: process.env.SPEC_PATH ?? "openapi.yaml",
  guidePath: process.env.GUIDE_PATH ?? "docs/migration-guide.md",
  // how long the docs PR can stay open before the notes are dropped
  approvalTimeout: process.env.APPROVAL_TIMEOUT ?? "7d",
  // a customer only counts as affected if they hit the endpoint inside this window
  usageWindowDays: Number(process.env.USAGE_WINDOW_DAYS ?? 30),
  model: process.env.NOTIFIER_MODEL ?? "claude-sonnet-5-5",
  emailFrom: process.env.EMAIL_FROM ?? "Murmurly API <onboarding@resend.dev>",
};

// docs PR branches get this prefix so the webhook task can tell them apart
export const BRANCH_PREFIX = "api-change-notifier/";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
