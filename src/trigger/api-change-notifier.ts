import { logger, metadata, schemaTask, webhooks } from "@trigger.dev/sdk";
import { z } from "zod";
import { BRANCH_PREFIX, config } from "../lib/config";
import { commentOnce, openFilePullRequest, readFile } from "../lib/github";
import { addGuideEntry } from "../lib/guide";
import { closedComment, docsPullRequestBody, impactComment, sentComment, timedOutComment } from "../lib/messages";
import { analyzeApiChange } from "./analyze-api-change";
import { github } from "./github";
import { sendMigrationNote } from "./send-migration-note";

const ClosedPullRequest = z.object({
  pull_request: z.object({
    merged: z.boolean(),
    merged_by: z.object({ login: z.string() }).nullish(),
  }),
});

export const apiChangeNotifier = schemaTask({
  id: "api-change-notifier",
  schema: z.object({
    repo: z.string().describe('e.g. "acme/api"'),
    prNumber: z.number().int().positive(),
  }),
  run: async ({ repo, prNumber }, { ctx }) => {
    metadata.set("status", "Analyzing the spec change");

    // its own run with an idempotency key, so a retry after the approval gets the
    // same plan back instead of asking the model again. what goes out is what got reviewed
    const analysis = await analyzeApiChange
      .triggerAndWait({ repo, prNumber }, { idempotencyKey: "analysis", tags: [`pr:${prNumber}`] })
      .unwrap();

    if (analysis.status === "skipped") {
      logger.info(analysis.reason);
      return analysis;
    }

    const { pr, plan, breaking } = analysis;
    const branch = `${BRANCH_PREFIX}pr-${pr.number}`;

    // created before the docs PR exists so its close can't arrive first. matching on
    // the branch works because we pick the name up front, the PR number doesn't exist yet
    const waiter = await webhooks.waiter.create(github, {
      match: {
        "header.x-github-event": "pull_request",
        "event.action": "closed",
        "event.repository.full_name": repo,
        "event.pull_request.head.ref": branch,
      },
      timeout: config.approvalTimeout,
      idempotencyKey: "docs-pr-closed",
      tags: [`pr:${pr.number}`],
    });

    const guide = (await readFile(repo, config.guidePath, pr.baseRef)) ?? "";
    const docsPr = await openFilePullRequest({
      fullName: repo,
      base: pr.baseRef,
      branch,
      filePath: config.guidePath,
      content: addGuideEntry(guide, {
        date: pr.mergedAt.slice(0, 10),
        title: plan.guideEntry.title,
        prNumber: pr.number,
        markdown: plan.guideEntry.markdown,
      }),
      commitMessage: `Add migration guide entry for #${pr.number}`,
      title: `Migration guide: ${plan.guideEntry.title}`,
      body: docsPullRequestBody({
        pr,
        plan,
        breaking,
        runUrl: `${process.env.TRIGGER_DASHBOARD_URL}/runs/${ctx.run.id}`,
      }),
    });
    await commentOnce(repo, pr.number, "impact", impactComment({ plan, docsPr }));

    // suspended until the docs PR closes, could be days, no compute while it waits
    metadata.set("status", `Waiting for #${docsPr.number} to be merged`);
    const closed = await webhooks.waiter.wait(waiter);

    if (!closed.ok) {
      await commentOnce(repo, pr.number, "timed-out", timedOutComment(docsPr, config.approvalTimeout));
      return { status: "timed-out" as const, docsPr: docsPr.number };
    }

    const { merged, merged_by } = ClosedPullRequest.parse(closed.output.event).pull_request;
    if (!merged) {
      await commentOnce(repo, pr.number, "closed", closedComment(docsPr));
      return { status: "closed" as const, docsPr: docsPr.number };
    }
    logger.info(`#${docsPr.number} merged${merged_by ? ` by ${merged_by.login}` : ""}`);

    metadata.set("status", `Sending ${plan.notes.length} migration notes`);
    const guideUrl = `${pr.repoUrl}/blob/${pr.baseRef}/${config.guidePath}`;
    const results = plan.notes.length
      ? await sendMigrationNote.batchTriggerAndWait(
          plan.notes.map((note) => ({
            payload: {
              customerId: note.customerId,
              subject: note.subject,
              body: note.body,
              guideUrl,
              change: `${repo}#${pr.number}`,
            },
            options: { idempotencyKey: `note-${note.customerId}`, tags: [`pr:${pr.number}`] },
          }))
        )
      : { runs: [] };

    const sent: string[] = [];
    const failed: string[] = [];
    results.runs.forEach((result, i) => (result.ok ? sent : failed).push(plan.notes[i]!.customer));

    await commentOnce(repo, pr.number, "sent", sentComment({ docsPr, sent, failed }));
    metadata.set("status", "Done");

    return { status: "sent" as const, docsPr: docsPr.number, sent, failed };
  },
});
