import { webhook } from "@trigger.dev/sdk";
import { z } from "zod";
import { BRANCH_PREFIX, config } from "../lib/config";
import { findChangedFile } from "../lib/github";
import { apiChangeNotifier } from "./api-change-notifier";
import { github } from "./github";

const MergedPullRequest = z.object({
  pull_request: z.object({
    number: z.number(),
    head: z.object({ ref: z.string() }),
  }),
  repository: z.object({ full_name: z.string() }),
});

export const onPullRequestMerged = webhook({
  id: "on-pull-request-merged",
  endpoint: github,
  filter:
    "header.x-github-event == 'pull_request' && event.action == 'closed' && event.pull_request.merged == true && event.pull_request.base.ref == event.repository.default_branch",
  onEvent: async ({ event }) => {
    const { pull_request: pr, repository } = MergedPullRequest.parse(event);

    // one of our own docs PRs. the run that opened it is already waiting on this merge
    if (pr.head.ref.startsWith(BRANCH_PREFIX)) return;

    // most merged PRs never touch the spec, so check here and keep those to one short run
    if (!(await findChangedFile(repository.full_name, pr.number, config.specPath))) return;

    await apiChangeNotifier.trigger(
      { repo: repository.full_name, prNumber: pr.number },
      // scoped to this run, so a retry won't start a second notifier
      { idempotencyKey: "notifier", tags: [`pr:${pr.number}`] }
    );
  },
});
