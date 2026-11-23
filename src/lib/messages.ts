import type { Plan } from "./agent";
import type { SpecChange } from "./oasdiff";

type PullRequestRef = { number: number; title: string };

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const customers = (count: number) => `${count} customer${count === 1 ? "" : "s"}`;

export function docsPullRequestBody(input: { pr: PullRequestRef; plan: Plan; breaking: SpecChange[]; runUrl: string }) {
  const { pr, plan, breaking } = input;

  const changes = breaking.map((c) => `- \`${c.method} ${c.path}\`: ${c.text}`).join("\n");

  const recipients = plan.notes.length
    ? [
        `### Who gets a note (${plan.notes.length})`,
        "",
        "| Customer | Why |",
        "| --- | --- |",
        ...plan.notes.map((n) => `| ${n.customer} | ${n.reason.replace(/\|/g, "\\|")} |`),
        "",
        plan.notes
          .map((n) => `<details>\n<summary>Note to ${n.customer}</summary>\n\n**Subject:** ${n.subject}\n\n${n.body}\n\n</details>`)
          .join("\n\n"),
      ].join("\n")
    : "### Who gets a note\n\nNobody. No customer called the affected endpoints in the usage window.";

  const skipped = plan.skipped.length
    ? `\n\n### Checked and left out (${plan.skipped.length})\n\n${plan.skipped.map((s) => `- ${s.customer}: ${s.reason}`).join("\n")}`
    : "";

  return `Updates the migration guide for #${pr.number} (${pr.title}).

**Merging this PR approves the notes below.** Once it's merged, they go out to ${customers(plan.notes.length)}. Close it without merging and nothing is sent.

### Breaking changes

${changes}

${recipients}${skipped}

---
Drafted by the API change notifier in [this run](${input.runUrl}).`;
}

export function impactComment(input: { plan: Plan; docsPr: { number: number } }) {
  const { plan, docsPr } = input;
  if (!plan.notes.length) {
    return `This PR has breaking changes, but no customer called the affected endpoints recently.

${plan.summary}

I've added a migration guide entry in #${docsPr.number}.`;
  }
  return `This PR breaks the API for ${customers(plan.notes.length)} (${list(plan.notes.map((n) => n.customer))}).

${plan.summary}

I've drafted the migration guide entry and a note to each of them in #${docsPr.number}. Merging it sends the notes.`;
}

export function sentComment(input: { docsPr: { number: number }; sent: string[]; failed: string[] }) {
  const { docsPr, sent, failed } = input;
  const lines = [
    sent.length
      ? `#${docsPr.number} is merged, so I sent migration notes to ${list(sent)}.`
      : `#${docsPr.number} is merged. There was nobody to send a note to.`,
  ];
  if (failed.length) lines.push(`These didn't send and need a follow-up by hand: ${list(failed)}.`);
  return lines.join("\n\n");
}

export const closedComment = (docsPr: { number: number }) =>
  `#${docsPr.number} was closed without merging, so the migration notes weren't sent.`;

export const timedOutComment = (docsPr: { number: number }, timeout: string) =>
  `Nobody merged #${docsPr.number} within ${timeout}, so the migration notes weren't sent. Merging it now won't send them either. To send them, trigger \`api-change-notifier\` again for this PR.`;
