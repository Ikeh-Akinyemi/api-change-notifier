import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type SpecChange = {
  id: string;
  level: "error" | "warning" | "info";
  method?: string;
  path?: string;
  text: string;
  comment?: string;
};

type OasdiffEntry = {
  id: string;
  text: string;
  comment?: string;
  level: number;
  operation?: string;
  path?: string;
};

const LEVELS: Record<number, SpecChange["level"]> = { 3: "error", 2: "warning", 1: "info" };

// `changelog` instead of `breaking`: the info entries are how the agent finds out
// what replaced something (diarization for speaker_labels, cursor for page)
export async function diffSpecs(before: string, after: string, fileName: string): Promise<SpecChange[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "oasdiff-"));
  const basePath = path.join(dir, `base-${fileName}`);
  const revisionPath = path.join(dir, `revision-${fileName}`);

  try {
    await writeFile(basePath, before);
    await writeFile(revisionPath, after);

    const { stdout } = await exec(
      "oasdiff",
      // the spec comes from a PR, so a $ref in it shouldn't get to make us fetch urls
      ["changelog", basePath, revisionPath, "--format", "json", "--allow-external-refs=false"],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const entries = JSON.parse(stdout.trim() || "[]") as OasdiffEntry[];
    return entries.map((entry) => ({
      id: entry.id,
      level: LEVELS[entry.level] ?? "info",
      method: entry.operation,
      path: entry.path,
      text: entry.text,
      comment: entry.comment,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("oasdiff not found on PATH (https://github.com/oasdiff/oasdiff)");
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const isBreaking = (change: SpecChange) => change.level !== "info";
