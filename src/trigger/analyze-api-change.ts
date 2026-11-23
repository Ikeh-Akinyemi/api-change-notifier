import { OpenTelemetry } from "@ai-sdk/otel";
import { logger, schemaTask } from "@trigger.dev/sdk";
import { registerTelemetry } from "ai";
import path from "node:path";
import { z } from "zod";
import { planMigration, type Plan } from "../lib/agent";
import { config } from "../lib/config";
import { findChangedFile, getPullRequest, mergeBase, readFile } from "../lib/github";
import { diffSpecs, isBreaking, type SpecChange } from "../lib/oasdiff";

// ai sdk 7 only emits spans through @ai-sdk/otel, and plain tasks don't register it.
// without this the trace has no llm or tool call spans
registerTelemetry(new OpenTelemetry());

export type Analysis =
  | { status: "skipped"; reason: string }
  | {
      status: "breaking";
      pr: { number: number; title: string; url: string; repoUrl: string; baseRef: string; mergedAt: string };
      breaking: SpecChange[];
      plan: Plan;
    };

export const analyzeApiChange = schemaTask({
  id: "analyze-api-change",
  schema: z.object({
    repo: z.string(),
    prNumber: z.number().int().positive(),
  }),
  run: async ({ repo, prNumber }): Promise<Analysis> => {
    const pr = await getPullRequest(repo, prNumber);
    if (!pr.merged) return { status: "skipped", reason: `#${prNumber} isn't merged` };

    const specFile = await findChangedFile(repo, prNumber, config.specPath);
    if (!specFile) return { status: "skipped", reason: `#${prNumber} doesn't change ${config.specPath}` };

    const base = await mergeBase(repo, pr.base.sha, pr.head.sha);
    const [before, after] = await Promise.all([
      readFile(repo, config.specPath, base),
      readFile(repo, config.specPath, pr.head.sha),
    ]);
    if (!before || !after) {
      return { status: "skipped", reason: `#${prNumber} adds or deletes ${config.specPath}, so there's nothing to compare` };
    }

    const changes = await diffSpecs(before, after, path.basename(config.specPath));
    const breaking = changes.filter(isBreaking);
    logger.info(`oasdiff found ${breaking.length} breaking changes`, { breaking });
    if (breaking.length === 0) return { status: "skipped", reason: "No breaking changes" };

    const guide = (await readFile(repo, config.guidePath, pr.base.ref)) ?? "";
    const plan = await planMigration({
      pr: { number: pr.number, title: pr.title, body: pr.body, url: pr.html_url },
      specPath: config.specPath,
      specPatch: specFile.patch ?? "",
      changes,
      guide,
    });

    return {
      status: "breaking",
      pr: {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        repoUrl: pr.base.repo.html_url,
        baseRef: pr.base.ref,
        mergedAt: pr.merged_at ?? new Date().toISOString(),
      },
      breaking,
      plan,
    };
  },
});
