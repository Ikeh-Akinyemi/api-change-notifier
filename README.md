# API change notifier

An AI agent that reads every merged pull request that changes your OpenAPI spec, works out from your own request logs which customers it breaks, and emails each of them a migration note once someone on your team approves it.

The demo company is Murmurly, a made-up speech-to-text API. Its spec is `openapi.yaml`, its migration guide is `docs/migration-guide.md`, and `npm run seed` builds 90 days of its request logs in SQLite.

## How it works

1. A pull request that touches `openapi.yaml` is merged. GitHub sends a `pull_request` webhook to a hosted [Trigger.dev](https://trigger.dev) endpoint, which verifies the signature and starts a run.
2. [oasdiff](https://github.com/oasdiff/oasdiff) compares the spec before and after the PR and lists the breaking changes.
3. An agent built with the [AI SDK](https://ai-sdk.dev) looks up who called each changed endpoint in the last 30 days, and which parameters and fields they sent. A removed field only breaks the customers who send it, so the agent checks before it writes to anyone.
4. It opens a docs PR with a new migration guide entry and the drafted notes, and comments on the merged PR with who's affected.
5. The run waits for the docs PR to close. A waiting run is suspended, so it uses no compute however long the review takes.
6. Merging the docs PR sends the notes through [Resend](https://resend.com) and comments on the original PR. Closing it without merging sends nothing.

The code:

- `src/trigger/github.ts`: the hosted webhook endpoint for the repo.
- `src/trigger/on-pull-request-merged.ts`: the webhook task. It starts the notifier for each merged PR that changes the spec. Anything else GitHub sends is filtered out before a run starts.
- `src/trigger/api-change-notifier.ts`: one run per merged PR. Opens the docs PR, waits on a webhook waiter for it to close, then sends the notes.
- `src/trigger/analyze-api-change.ts`: the oasdiff diff and the agent, as their own task so the trace shows every model and tool call.
- `src/trigger/send-migration-note.ts`: one email per run, so a failed send retries on its own.
- `src/lib/agent.ts`: the prompt, the tools and the shape of the plan the agent returns.
- `src/lib/usage.ts`: the queries against the request logs. Point these at your own logs.

## What keeps it safe

- **A person approves every email.** Nothing goes out until someone merges the docs PR, and the notes they read in it are the notes that get sent. The analysis runs once per merged PR, so a retry can't redraft them.
- **The model can't choose an address.** Notes name a customer id from the request logs, and only customers the tools returned can get one. The address is looked up from your records when the email is sent.
- **PR text is treated as data.** The title, description and diff are fenced off in the prompt, and the model is told never to follow instructions in them.
- **No URL fetching from specs.** oasdiff runs with `--allow-external-refs=false`, so a `$ref` in a PR can't make it fetch an internal URL.
- **Retries don't repeat side effects.** Comments carry a hidden marker, the docs PR reuses its branch, and each email is sent with a Resend idempotency key.

## Setup

You need Node.js 22.18 or later, [oasdiff](https://github.com/oasdiff/oasdiff) on your PATH (`brew install oasdiff`, or a binary from its [releases](https://github.com/oasdiff/oasdiff/releases)), a [Trigger.dev](https://cloud.trigger.dev) project, a [Claude API](https://platform.claude.com) key and a [Resend](https://resend.com) API key.

1. Push this project to a GitHub repo of your own. The agent watches that repo, so the spec and the guide live there.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for that repo with read and write access to **Contents** and **Pull requests**. Create it from the account that owns the repo, because fine-grained tokens can't reach repos you're only a collaborator on.
3. Copy `.env.example` to `.env` and fill it in.
4. Run `npm install`, `npm run seed` and `npm run dev`. The first time, the CLI asks you to log in to Trigger.dev. Once it's running, the `github` endpoint appears on the **Webhooks** page of your Development environment.
5. Open the `github` endpoint and go to its **Settings** tab. Choose **Generate secret** and copy it, then copy the **Webhook URL** from the same tab.
6. In the GitHub repo, go to **Settings** > **Webhooks** > **Add webhook**. Paste the URL and the secret, and set **Content type** to `application/json`. Choose **Let me select individual events**, untick **Pushes**, which GitHub ticks by default, and tick **Pull requests**. GitHub sends a `ping` straight away, and it shows up as `FILTERED` on the endpoint's **Deliveries** tab, which is expected because only merged pull requests get through.

## Try it

The seeded calls end on the day you ran `npm run seed`. If that was a few days ago, run it again and restart `npm run dev`, which copies `data/usage.db` when it starts. Then, with `npm run dev` running:

```bash
git checkout -b move-word-timings
cp demo/openapi.next.yaml openapi.yaml
git commit -am "Move word timings into the transcript"
git push -u origin move-word-timings
```

Open a PR for the branch and merge it. The change removes `GET /v1/transcripts/{id}/words`, renames `speaker_labels` to `diarization` and replaces `page` with a cursor. In the seeded logs, three customers break and three don't.

A minute or so later the merged PR gets a comment, and a PR titled **Migration guide: ...** is open. Read the notes in its description, then merge it. The notes go to Resend's `delivered+...@resend.dev` test addresses, so you can see them in the Resend dashboard without emailing anyone.

PRs #1 and #2 in this repo are the production run shown in the blog post and the recording. `main` was reset to the original spec and guide after that run, so these steps work on a fresh clone.

## Deploy

Run `npm run deploy`, add the same environment variables to the production environment in the dashboard, and point the GitHub webhook at the production endpoint URL with that endpoint's secret. The deploy build downloads oasdiff into the image (see `trigger.config.ts`) and ships `data/usage.db` with the code, so run `npm run seed` first.
