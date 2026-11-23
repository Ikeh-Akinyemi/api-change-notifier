import { webhooks } from "@trigger.dev/sdk";

// trigger.dev verifies the signature on every delivery before any task sees it
export const github = webhooks.endpoint.define({
  id: "github",
  source: webhooks.github(),
});
