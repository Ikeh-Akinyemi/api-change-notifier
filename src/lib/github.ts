import { Octokit } from "@octokit/rest";
import { requireEnv } from "./config";

let client: Octokit | undefined;

function github(): Octokit {
  client ??= new Octokit({
    auth: requireEnv("GITHUB_TOKEN"),
    userAgent: "api-change-notifier",
    baseUrl: process.env.GITHUB_API_URL, // only needed for GitHub Enterprise Server
  });
  return client;
}

function parseRepo(fullName: string) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`expected "owner/name", got "${fullName}"`);
  return { owner, repo };
}

const isStatus = (error: unknown, status: number) => (error as { status?: number }).status === status;

export async function getPullRequest(fullName: string, number: number) {
  const { data } = await github().pulls.get({ ...parseRepo(fullName), pull_number: number });
  return data;
}

export async function findChangedFile(fullName: string, number: number, filePath: string) {
  const files = await github().paginate(github().pulls.listFiles, { ...parseRepo(fullName), pull_number: number, per_page: 100 });
  return files.find((file) => file.filename === filePath);
}

// diff from the merge base rather than base.sha, so whatever landed on main
// while the PR was open doesn't get counted as part of this change
export async function mergeBase(fullName: string, base: string, head: string): Promise<string> {
  const { data } = await github().repos.compareCommitsWithBasehead({ ...parseRepo(fullName), basehead: `${base}...${head}` });
  return data.merge_base_commit.sha;
}

export async function readFile(fullName: string, filePath: string, ref: string): Promise<string | undefined> {
  try {
    const { data } = await github().repos.getContent({
      ...parseRepo(fullName),
      path: filePath,
      ref,
      mediaType: { format: "raw" },
    });
    // octokit gives back a string or an ArrayBuffer here, depending on the content-type github sends
    const raw = data as unknown as string | ArrayBuffer;
    return typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  } catch (error) {
    if (isStatus(error, 404)) return undefined;
    throw error;
  }
}

// safe to call again after a retry: reuses the branch, skips the commit if the
// file already matches, and returns the PR if it's already open
export async function openFilePullRequest(input: {
  fullName: string;
  base: string;
  branch: string;
  filePath: string;
  content: string;
  commitMessage: string;
  title: string;
  body: string;
}) {
  const repo = parseRepo(input.fullName);
  const octokit = github();

  const { data: baseRef } = await octokit.git.getRef({ ...repo, ref: `heads/${input.base}` });
  try {
    await octokit.git.createRef({ ...repo, ref: `refs/heads/${input.branch}`, sha: baseRef.object.sha });
  } catch (error) {
    if (!isStatus(error, 422)) throw error; // 422 = branch already exists
  }

  const current = await currentFile(input.fullName, input.filePath, input.branch);
  if (current?.content !== input.content) {
    await octokit.repos.createOrUpdateFileContents({
      ...repo,
      path: input.filePath,
      branch: input.branch,
      message: input.commitMessage,
      content: Buffer.from(input.content).toString("base64"),
      sha: current?.sha,
    });
  }

  const { data: open } = await octokit.pulls.list({ ...repo, head: `${repo.owner}:${input.branch}`, state: "open" });
  if (open[0]) return { number: open[0].number, url: open[0].html_url };

  const { data: pr } = await octokit.pulls.create({
    ...repo,
    base: input.base,
    head: input.branch,
    title: input.title,
    body: input.body,
  });
  return { number: pr.number, url: pr.html_url };
}

async function currentFile(fullName: string, filePath: string, ref: string) {
  try {
    const { data } = await github().repos.getContent({ ...parseRepo(fullName), path: filePath, ref });
    if (Array.isArray(data) || data.type !== "file") return undefined;
    return { sha: data.sha, content: Buffer.from(data.content, "base64").toString("utf8") };
  } catch (error) {
    if (isStatus(error, 404)) return undefined;
    throw error;
  }
}

// the hidden marker lets a retried run find the comment it already posted
export async function commentOnce(fullName: string, number: number, key: string, body: string) {
  const marker = `<!-- api-change-notifier:${key} -->`;
  const repo = parseRepo(fullName);
  const comments = await github().paginate(github().issues.listComments, { ...repo, issue_number: number, per_page: 100 });
  if (comments.some((comment) => comment.body?.includes(marker))) return;
  await github().issues.createComment({ ...repo, issue_number: number, body: `${body}\n\n${marker}` });
}
