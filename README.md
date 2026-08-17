# Jules-Style Async Agent (Vercel AI Gateway Edition)

An analogue of **Jules** — the asynchronous coding agent — rebuilt from the Vercel Coding Agent Template to run on **Vercel Hobby (Free Tier)** with **Vercel AI Gateway** as the sole inference provider.

Give it a repo + a task and it works **detached**: clones, branches, edits code inside a Vercel Sandbox VM, streams logs, pushes, and is wired for PR automation. No direct Anthropic/OpenAI/Gemini keys — every model call is routed through **AI Gateway** (`https://ai-gateway.vercel.sh`) with a single `AI_GATEWAY_API_KEY`.

![Coding Agent Template Screenshot](screenshot.png)

## Table of Contents

- [What This Is](#what-this-is)
- [How Jules-Style Async Works Here](#how-jules-style-async-works-here)
- [Architecture](#architecture)
- [Free-Tier Constraints (and How They Are Met)](#free-tier-constraints-and-how-they-are-met)
- [Vercel AI Gateway — The Only Model Path](#vercel-ai-gateway--the-only-model-path)
- [Plan Approval Workflow (Gateway Agent)](#plan-approval-workflow-gateway-agent)
- [Task Steering](#task-steering)
- [Audio Changelog](#audio-changelog)
- [Metrics Dashboard](#metrics-dashboard)
- [Deploy to Vercel (One Click)](#deploy-to-vercel-one-click)
- [Local Development](#local-development)
- [Full Documentation](#full-documentation)
- [Configuration Reference](#configuration-reference)
- [API Reference](#api-reference)
- [GitHub Webhook — `/jules` Trigger](#github-webhook--jules-trigger)
- [Cron Jobs](#cron-jobs)
- [Task & Database Model](#task--database-model)
- [Security](#security)
- [Development Scripts](#development-scripts)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What This Is

This repo is a **mutation**, not a rewrite, of [`vercel-labs/coding-agent-template`](https://github.com/vercel-labs/coding-agent-template):

- **Before**: `POST /api/tasks` held a serverless function open with `after()` + 6 agents (Claude, Codex, Copilot, Cursor, Gemini, opencode) each requiring its own provider key, and `vercel.json` set `maxDuration: 300` (5 minutes — breaks Hobby's 10s limit).
- **After**: `POST /api/tasks` returns `201` within **≤3.5s** (fallback branch/title synchronously, bounded 3.5s race for AI names). Heavy work lives **inside the Sandbox VM** (its own timeout, `vcpus: 2`, default `60m`), started via a second Hobby-safe `POST /api/tasks/[id]/start`. A single **Gateway agent** drives edits; Claude/Codex remain available **via Gateway**. All API routes are `maxDuration: 10`.

If you came from the original template, see [What Changed](#what-changed-from-the-upstream-template) at the bottom for a diff.

## How Jules-Style Async Works Here

```
[You / GitHub Webhook]
        │  POST /api/tasks  { prompt, repoUrl, selectedAgent, selectedModel }
        ▼
   DB: tasks { status: "pending", branchName: fallback, title: fallback }
        │  (bounded 3.5s AI branch/title race via Gateway; keeps Hobby limit)
   201 { task }
        │  client immediately calls POST /api/tasks/[id]/start
        ▼
   start route (Hobby, ≤10s): validates Gateway key + GitHub token
        │  createSandbox()  →  Sandbox.create({ timeout: "60m", vcpus: 2, ports })
        │    git clone --depth 1  →  checkout branch  →  optional install  →  optional dev server
        │  registers sandboxId, flips task → status: "processing"
        ▼  (function returns — no holding)
[Sandbox VM — the Jules worker]
        │  executeAgentInSandbox()  (gateway | claude | codex, all via AI_GATEWAY_API_KEY)
        │    streams logs → tasks.logs (polling) and task_messages
        │    edits files  →  pushChangesToBranch()  →  git push origin <branch>
        ▼
   tasks { status: "completed" | "error", prUrl/prNumber when created, sandboxUrl }
        ▲
        │  polling: GET /api/tasks/[id] every 5s (useTask), messages every 3s
[Browser / GitHub]
```

**Jules delight kept**: repo picker in the header, per-task logs + file browser + diff + preview iframe + chat/continue, PR create/merge/close, sandbox terminal & LSP.

## Architecture

| Layer     | Choice                                                                                      | Why                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute   | **Vercel Sandbox** (`@vercel/sandbox`)                                                      | Isolated VM that outlives the serverless function — perfect for Jules detached work. Free-tier trick: the function only _starts_ the VM (<10s). |
| Inference | **Vercel AI Gateway** (`ai` SDK `generateText` with `openai/gpt-5-nano`, `anthropic/...`)   | Single key, model routing by string, no per-provider secrets. Branch/title/commit names and the native `gateway` agent all use it.              |
| Async     | Two-phase `POST /api/tasks` → `POST /api/tasks/[id]/start` + polling + `GET /api/cron/reap` | Hobby has no Queues/Workflow. The VM is the queue; the cron is the reaper.                                                                      |
| DB        | **Neon Postgres** + **Drizzle ORM** (`drizzle.config.ts`)                                   | Provisioned automatically via the Vercel Deploy Button (`vercel-template.json`).                                                                |
| Auth      | **GitHub** and/or **Vercel OAuth** (`arctic` + `jose` JWE cookie)                           | Same as upstream — required for repo access.                                                                                                    |
| UI        | Next.js 16, React 19, Tailwind, shadcn/ui                                                   | Unchanged.                                                                                                                                      |

### Request lifecycle (annotated)

1. `TaskForm` validates (`prompt`, Gateway model) then `POST /api/tasks`.
2. Server: rate-limit → `insertTaskSchema` → `db.insert(tasks)` with **fallback** `branchName`/`title` → **bounded** AI generation (`Promise.race(..., 3500ms)`) upgrades them in place if Gateway responds in time.
3. Client receives `201 { task }` and immediately `POST /api/tasks/[id]/start`.
4. `start` route creates the Sandbox, writes `sandboxId/sandboxUrl`, marks `processing`, and runs `runTaskAsync()` (in `lib/sandbox/orchestrator.ts`) — agent execution + `pushChangesToBranch` + `logger.updateStatus`.
5. UI polls via `lib/hooks/use-task.ts` (5s tasks, 3s messages, 30s checks/deployments).
6. `GET /api/cron/reap` (every 5m) visits `processing` tasks whose `updatedAt` is stale, probes the Sandbox, and recovers.

## Free-Tier Constraints (and How They Are Met)

Vercel Hobby limits are documented at `https://vercel.com/docs/functions/limitations`:

- `maxDuration: 10` — every function in `vercel.json` is **10** (not 300). The original `300` would fail to deploy on Hobby.
- No `after()`-forever: the old template used three `after()` continuations to generate branch/title and run `processTaskWithTimeout` (holding the function). This template removes `after()` from `/api/tasks` and runs heavy work inside the **Sandbox VM**, not the function.
- Sandbox defaults lowered: `MAX_SANDBOX_DURATION` is now **60** (not 300) and `vcpus: 2` (not 4). Override with env `MAX_SANDBOX_DURATION`.
- One cron only: `crons: [{ path: "/api/cron/reap", schedule: "*/5 * * * *" }]` — Hobby allows a single cron.

## Vercel AI Gateway — The Only Model Path

`lib/constants.ts` is the single source of truth:

```ts
export const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh'
export const GATEWAY_DEFAULT_MODEL = 'openai/gpt-5-nano'
export const GATEWAY_MODELS = [
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-haiku-4-5',
  'google/gemini-2.5-pro',
] as const
```

- Host code (`lib/utils/branch-name-generator.ts`, `title-generator.ts`, `commit-message-generator.ts`) uses `generateText({ model: 'openai/gpt-5-nano' })` via the SDK — routed through Gateway when `AI_GATEWAY_API_KEY` is set.
- Claude CLI is configured with `ANTHROPIC_API_KEY=${AI_GATEWAY_API_KEY}` + `ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh` (`lib/sandbox/agents/claude.ts`).
- Codex CLI writes `~/.codex/config.toml` with `model_provider = "vercel-ai-gateway"`, `base_url = "https://ai-gateway.vercel.sh/v1"` (`lib/sandbox/agents/codex.ts`).
- The native `gateway` agent (`lib/sandbox/agents/gateway.ts`) is the recommended Jules brain: it uses the `ai` SDK + `generateText` with tools (`readFile`, `writeFile`, `runCommand`, `listFiles`) that execute **inside** the sandbox via `sandbox.runCommand` — no CLI install needed, fully Gateway-native.
- User keys: only `AI_GATEWAY_API_KEY` is required (`keys.provider = 'aigateway'`). Legacy providers (`anthropic`, `openai`, `gemini`, `cursor`) still exist in `lib/db/schema.ts` but the UI hides them under "Legacy providers" and `lib/sandbox/config.ts` treats them as legacy gated by `ENABLE_LEGACY_AGENTS`.

> **Key shape**: `AI_GATEWAY_API_KEY` accepts `vck_...` (Vercel-issued Gateway key) or `gw_...`.

## Plan Approval Workflow (Gateway Agent)

When using the default `gateway` agent, task execution is split into **two phases** — planning and execution — with a **user approval checkpoint** in between:

1. **Plan**: The planner agent (Gemini Pro via AI Gateway) explores your repo and generates a structured plan (`goal`, `assumptions`, `steps` with risk levels, file/LOC estimates, test command). Stored in the `plans` table; task enters `awaiting_approval` status.
2. **Approve**: You review the plan in the UI (`PlanEditor` component), optionally edit it (JSON editor with Zod validation), and click "Approve & Run".
3. **Execute**: `POST /api/tasks/[taskId]/approve` triggers `runExecutionPhase()` — a new sandbox is created, the agent executes with the approved plan appended to the prompt, pushes changes, and creates a PR.

During `processing`, you can also **steer** the agent mid-run with guidance messages. See [Plan Approval Workflow](./docs/features/planning.md) and [Task Steering](./docs/features/steering.md) for full details.

> **CI auto-fix**: If the task prompt starts with `"CI failed"`, the planner is constrained to at most 3 steps and 2 files — minimum change to make CI green, no scope creep.

## Task Steering

While a task is in `processing` status, you can send mid-run guidance messages via `POST /api/tasks/[taskId]/steer`:

- Max 2000 characters per message
- 5-second cooldown between messages (returns `429` with `Retry-After: 5`)
- The Gateway agent polls the `steering_messages` table after every tool call and injects pending messages into its context
- Rendered in the UI by the `SteerInput` component — a text box that appears at the bottom of the task view during `processing`

See [Task Steering](./docs/features/steering.md) for details.

## Audio Changelog

After a task completes, you can generate an AI-narrated changelog:

- **Manual**: Click "Generate" in the `AudioPlayer` component (shown on completed tasks)
- **Automatic**: The `/api/cron/audio` cron job (every 10 min) generates audio for completed tasks without one
- Uses `openai/gpt-5-nano` (via Gateway) to generate a 60–90 second transcript explaining what the PR does
- Optionally converts to MP3 via **ElevenLabs** (`ELEVENLABS_API_KEY`); falls back to a text file if not configured
- Stored in **Vercel Blob** (public URL); cached by diff hash to avoid re-generation
- Posted as a comment on the PR: `🎧 [Listen](url) (Xs) — AI-generated changelog`

See [Audio Changelog](./docs/features/audio-summaries.md) for details.

## Metrics Dashboard

Daily task metrics are aggregated automatically and displayed on an admin-only page:

- **Route**: `/admin/metrics` (gated by `NEXT_PUBLIC_ADMIN_ENABLED=true`)
- **Cron**: `/api/cron/metrics` runs daily at 00:05 UTC, counts tasks created/completed/failed
- Shows a 7-day summary table, success rate chart, and 30-day expandable view
- See [Metrics Dashboard](./docs/features/metrics.md) for details

## Deploy to Vercel (One Click)

[![Deploy with Vercel](https://vercel.com/button)](<https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fcoding-agent-template&env=SANDBOX_VERCEL_TEAM_ID,SANDBOX_VERCEL_PROJECT_ID,SANDBOX_VERCEL_TOKEN,JWE_SECRET,ENCRYPTION_KEY&envDescription=Required+environment+variables+for+the+coding+agent+template.+You+must+also+configure+at+least+one+OAuth+provider+(GitHub+or+Vercel)+after+deployment.+Optional+API+keys+can+be+added+later.&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D&project-name=coding-agent-template&repository-name=coding-agent-template>)

What happens:

- A **Neon Postgres** is provisioned and `POSTGRES_URL` is set.
- You are prompted for the required env vars (see below).
- After deploy, configure **at least one OAuth provider** (GitHub or Vercel) in your Vercel project settings.

## Local Development

```bash
git clone <this-repo>
cd <this-repo>
pnpm install

# create .env.local (see Configuration Reference)
pnpm db:push
pnpm dev   # http://localhost:3000
```

`pnpm dev` runs `next dev --webpack`. Do **not** run multiple dev servers against the same port.

## Full Documentation

This README provides a high-level overview. For comprehensive documentation, see the `docs/` directory:

- **[Setup Guide](./docs/setup.md)** — detailed local and production setup instructions
- **[Configuration Reference](./docs/configuration.md)** — complete environment variable reference with `.env.local` template
- **[Architecture](./docs/architecture.md)** — deep dive on the two-phase execution model and state machine
- **[API Reference](./docs/api.md)** — complete REST API documentation
- **[Database Schema](./docs/database.md)** — all tables, columns, and migrations
- **[Agent Configuration](./docs/agents.md)** — Gateway, Claude, Codex, and legacy agents
- **[Plan Approval Workflow](./docs/features/planning.md)** — plan generation and approval flow
- **[Task Steering](./docs/features/steering.md)** — mid-run agent guidance
- **[Audio Changelog](./docs/features/audio-summaries.md)** — AI-narrated changelog feature
- **[Metrics Dashboard](./docs/features/metrics.md)** — daily task metrics
- **[Development Guide](./docs/development.md)** — scripts, code style, and contributing
- **[Security Guidelines](./docs/security.md)** — logging policy, credential handling, and compliance checklist

## Configuration Reference

### Required — App infrastructure (set once, by you)

| Variable                    | Where used                                                               | How to get it                                                               |
| --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `POSTGRES_URL`              | `drizzle.config.ts`, `lib/db/client.ts`, `scripts/migrate-production.ts` | Auto-set on Vercel via Neon integration; locally, any Postgres URL          |
| `SANDBOX_VERCEL_TOKEN`      | `lib/sandbox/creation.ts`, 12+ sandbox routes                            | Vercel Dashboard → your project → Settings → Tokens                         |
| `SANDBOX_VERCEL_TEAM_ID`    | Same as above                                                            | Vercel Dashboard → Team settings → General                                  |
| `SANDBOX_VERCEL_PROJECT_ID` | Same as above                                                            | Vercel Dashboard → Project → Settings → General (or `.vercel/project.json`) |
| `JWE_SECRET`                | `lib/jwe/encrypt.ts`, `lib/jwe/decrypt.ts`                               | `openssl rand -base64 32`                                                   |
| `ENCRYPTION_KEY`            | `lib/crypto.ts`                                                          | `openssl rand -hex 32` (32 bytes, hex)                                      |

### Required — Auth (at least one)

| Variable                                                | Meaning                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `NEXT_PUBLIC_AUTH_PROVIDERS`                            | `"github"`, `"vercel"`, or `"github,vercel"` (default `github`)              |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App; callback `https://<host>/api/auth/github/callback`         |
| `NEXT_PUBLIC_VERCEL_CLIENT_ID` / `VERCEL_CLIENT_SECRET` | Vercel OAuth integration; callback `https://<host>/api/auth/callback/vercel` |

Create OAuth apps:

- **GitHub**: https://github.com/settings/developers → New OAuth App → Authorization callback URL `http://localhost:3000/api/auth/github/callback` (and production URL).
- **Vercel**: https://vercel.com/dashboard → Team → Integrations → Create; Redirect URL `http://localhost:3000/api/auth/callback/vercel`.

### AI — Gateway only

| Variable             | Meaning                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (`vck_...` or `gw_...`). Global fallback; **or** set per-user in the profile dialog (`keys.provider = 'aigateway'`, stored encrypted). Required for branch/title/commit generation and for every agent. |

### Optional

| Variable                       | Default                | Meaning                                                                                                                                                      |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MAX_SANDBOX_DURATION`         | `60`                   | Minutes the Sandbox VM lives (`lib/constants.ts`). Original template defaulted to `300`; trimmed for Hobby.                                                  |
| `MAX_MESSAGES_PER_DAY`         | `5`                    | Tasks + follow-ups per user per day (`lib/utils/rate-limit.ts`).                                                                                             |
| `NPM_TOKEN`                    | —                      | Private npm access inside sandboxes.                                                                                                                         |
| `GITHUB_WEBHOOK_SECRET`        | —                      | HMAC for `POST /api/webhooks/github` (`x-hub-signature-256`). If unset, signature verification is skipped (noisy; set it in prod).                           |
| `WEBHOOK_DEFAULT_USER_ID`      | —                      | User ID to attribute webhook-created tasks to when the webhook has no session. Required if you enable the `/jules` webhook without per-install user mapping. |
| `INGEST_TOKEN` / `CRON_SECRET` | —                      | Bearer tokens for `POST /api/tasks/[id]/ingest-logs` and cron routes if you call them outside Vercel cron.                                                   |
| `ENABLE_LEGACY_AGENTS`         | —                      | Set to `1` to allow `copilot`/`cursor`/`gemini`/`opencode` in `lib/sandbox/agents/index.ts`. Default: blocked with a helpful error.                          |
| `NEXT_PUBLIC_ADMIN_ENABLED`    | —                      | Set to `true` to enable the `/admin/metrics` dashboard page.                                                                                                 |
| `ELEVENLABS_API_KEY`           | —                      | ElevenLabs API key for MP3 audio generation of changelog summaries. If unset, audio summaries are stored as text files.                                      |
| `ELEVENLABS_VOICE_ID`          | `21m00Tcm4TlvDq8ikWAM` | Custom voice ID for ElevenLabs TTS.                                                                                                                          |

> `.env*` is gitignored. Never commit `.env.local`.

## API Reference

All task routes require **authentication** (`getServerSession()` via JWE cookie `_user_session_`). Tasks are scoped to `tasks.userId` with soft delete (`isNull(deletedAt)`).

### Tasks

| Method   | Path                                         | Description                                                                                                                                                                                                          |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/tasks`                                 | List your tasks (`deletedAt IS NULL`, newest first).                                                                                                                                                                 |
| `POST`   | `/api/tasks`                                 | Create a task. **Returns 201 in ≤3.5s** (Hobby-safe). Upgrades `branchName`/`title` in the background. Body: `insertTaskSchema` (see below).                                                                         |
| `DELETE` | `/api/tasks?action=completed,failed,stopped` | Hard-delete by status, scoped to `userId`.                                                                                                                                                                           |
| `GET`    | `/api/tasks/[taskId]`                        | Fetch one task (authz `userId` + `isNull(deletedAt)`).                                                                                                                                                               |
| `PATCH`  | `/api/tasks/[taskId]`                        | Update task (`action: 'stop'` kills sandbox, etc.).                                                                                                                                                                  |
| `DELETE` | `/api/tasks/[taskId]`                        | Soft-delete (`deletedAt = now()`).                                                                                                                                                                                   |
| `POST`   | `/api/tasks/[taskId]/start`                  | **Hobby async start** — creates the Sandbox, runs `runTaskAsync()` or `runPlannerPhase()` (agent → push → `completed`/`error`). Fire-and-forget; UI calls it immediately after `POST /api/tasks`. `maxDuration: 10`. |
| `POST`   | `/api/tasks/[taskId]/continue`               | Follow-up (`{ message }`): inserts `task_messages` (`role: 'user'`), resumes Sandbox if `keepAlive && sandboxId`, re-runs the selected agent with history.                                                           |
| `GET`    | `/api/tasks/[taskId]/messages`               | `task_messages` for the task (`ORDER BY createdAt`).                                                                                                                                                                 |
| `POST`   | `/api/tasks/[taskId]/plan`                   | Create a new plan version. Body validated against `planSchema` (Zod).                                                                                                                                                |
| `GET`    | `/api/tasks/[taskId]/plan`                   | List all plans for a task (newest version first).                                                                                                                                                                    |
| `POST`   | `/api/tasks/[taskId]/approve`                | Approve a plan → sets `status: 'processing'` → triggers `runExecutionPhase()` via `after()`. Only valid when `status === 'awaiting_approval'`.                                                                       |
| `POST`   | `/api/tasks/[taskId]/steer`                  | Inject a mid-run guidance message (max 2000 chars, 5s cooldown). Only valid when `status === 'processing'`. Body: `{ message: string }`.                                                                             |
| `POST`   | `/api/tasks/[taskId]/audio`                  | Generate an audio changelog for a completed task (`202` queued, `200` if cached).                                                                                                                                    |
| `GET`    | `/api/tasks/[taskId]/audio`                  | Fetch the latest audio summary for a task (or null).                                                                                                                                                                 |
| `POST`   | `/api/tasks/[taskId]/retry`                  | Retry a failed/stopped task. `gateway` agent → `runPlannerPhase()`; legacy agents → `runTaskAsync()`.                                                                                                                |

#### `POST /api/tasks` body (`insertTaskSchema`)

```ts
{
  id?: string               // optional; generated if absent (12-char nanoid)
  prompt: string            // required — the Jules instruction
  repoUrl?: string          // clone URL (https://github.com/owner/repo[.git])
  selectedAgent?: 'gateway' | 'claude' | 'codex' | 'copilot' | 'cursor' | 'gemini' | 'opencode'
                            // default 'gateway' (Gateway-only); legacy agents need ENABLE_LEGACY_AGENTS
  selectedModel?: string    // e.g. openai/gpt-5-nano; falls back to DEFAULT_MODELS[agent]
  gatewayModel?: string     // canonical Gateway model string (preferred over selectedModel for audit)
  installDependencies?: boolean // default false
  maxDuration?: number      // minutes; default MAX_SANDBOX_DURATION (60)
  keepAlive?: boolean       // keep VM alive after completion for follow-ups
  enableBrowser?: boolean   // install agent-browser + Chromium + skill file
  mcpServerIds?: string[]
  branchName?: string       // optional; fallback generated with nanoid hash
  title?: string
}
```

Response `201 { task }` — the task row as stored (the `branchName`/`title` may be fallback initially and upgrade seconds later via Gateway).

#### Task statuses

`pending` → `processing` → `completed` | `error` | `stopped` (with `progress 0-100`, `logs: LogEntry[]`, `error?`, `prUrl/prNumber/prStatus`, `sandboxId/sandboxUrl`, `agentSessionId`).

For the `gateway` agent, an intermediate `awaiting_approval` status is inserted: `pending` → `processing` → `awaiting_approval` → `processing` → `completed` | `error` | `stopped`.

`GET /api/tasks/[taskId]` also returns the latest `plan` (if any) and `audioSummary` (if any) alongside the task.

### Sandboxes

| Method | Path                                 | Description                                                                                                                                                                                        |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/sandboxes`                     | Your active sandboxes (`sandboxId IS NOT NULL`).                                                                                                                                                   |
| `GET`  | `/api/tasks/[taskId]/sandbox-health` | `sandbox.runCommand('pwd')` probe.                                                                                                                                                                 |
| `POST` | `/api/tasks/[taskId]/start-sandbox`  | Recreate/attach to sandbox if it died.                                                                                                                                                             |
| `POST` | `/api/tasks/[taskId]/stop-sandbox`   | `killSandbox(taskId)` + `sandboxId = NULL`.                                                                                                                                                        |
| `POST` | `/api/tasks/[taskId]/restart-dev`    | Re-start `npm run dev` (detached + host fixup).                                                                                                                                                    |
| `POST` | `/api/tasks/[taskId]/terminal`       | `POST { command }` → `sandbox.runCommand('sh', ['-c', cmd])`.                                                                                                                                      |
| `POST` | `/api/tasks/[taskId]/ingest-logs`    | Internal: `POST { logs: LogEntry[], progress?, status? }` — appends to `tasks.logs`. Authorized by `x-vercel-cron` or `Bearer $SANDBOX_VERCEL_TOKEN` / `Bearer $INGEST_TOKEN`. Not user-sessioned. |

### Files, diffs, PRs

| Method     | Path                                                                              |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`      | `/api/tasks/[taskId]/files`, `/project-files`, `/file-content?filename&mode=local | remote`, `/diff?filename&mode=local`, `/sync-changes`, `/sync-pr`, `/clear-logs`, `/save-file`, `/create-file`, `/create-folder`, `/delete-file`, `/file-operation`, `/discard-file-changes`, `/reset-changes`, `/autocomplete`, `/lsp`, `/deployment`, `/check-runs` |
| `GET/POST` | `/api/tasks/[taskId]/pr`, `/close-pr`, `/reopen-pr`, `/merge-pr`, `/pr-comments`  |

All operate on `PROJECT_DIR = /vercel/sandbox/project` inside the VM, or on GitHub via Octokit + the user's decrypted GitHub token (`getUserGitHubToken()`).

### Cron Jobs

Defined in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/reap", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/audio", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/metrics", "schedule": "5 0 * * *" }
  ]
}
```

| Method | Path                | Schedule           | Description                                                                                                                                                                                                                    |
| ------ | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/cron/reap`    | Every 5 min        | Queries stale `processing` tasks (`updatedAt < now()-5m`), probes sandbox, logs if sandbox is gone. Authorized by `x-vercel-cron` or `Bearer $CRON_SECRET` / `Bearer $SANDBOX_VERCEL_TOKEN`; always allowed in non-production. |
| `GET`  | `/api/cron/audio`   | Every 10 min       | Finds one completed task without an audio summary, generates it. Authorized by `x-vercel-cron` or `Bearer` token.                                                                                                              |
| `GET`  | `/api/cron/metrics` | Daily at 00:05 UTC | Aggregates yesterday's task counts into `metrics_daily` table. Authorized by `x-vercel-cron` or `Bearer` token.                                                                                                                |

Manual test (dev only):

```bash
curl -H "x-vercel-cron: 1" http://localhost:3000/api/cron/reap
```

Vercel Hobby allows a maximum of **3 crons**. This project uses all 3.

### Webhooks

| Method | Path                   | Description                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/webhooks/github` | Jules trigger. Verifies `x-hub-signature-256` with `GITHUB_WEBHOOK_SECRET`, records `webhook_events`, extracts `prompt` from `issue.body` or `/jules <prompt>` in `issue_comment`, creates a DB `task` (`selectedAgent: 'gateway'`). Requires `WEBHOOK_DEFAULT_USER_ID` to attribute the task. `maxDuration: 10`. |

### Keys & Connectors

| Method            | Path                                                                     | Description                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | -------- | ----------------------------------------------------------------- |
| `GET/POST/DELETE` | `/api/api-keys`                                                          | CRUD `keys` (`provider: 'aigateway'                                                                                                                  | 'anthropic' | 'openai' | 'cursor' | 'gemini'`, encrypted via `lib/crypto.ts`). UI emphasizes Gateway. |
| `GET`             | `/api/api-keys/check?agent=&model=`                                      | Returns `{ hasKey, provider, agentName }` — now Gateway-centric (all agents route through `aigateway` unless `copilot` with `getUserGitHubToken()`). |
| `GET/POST/DELETE` | `/api/connectors`                                                        | MCP servers for Claude (`local`/`remote`, encrypted `env`/`oauthClientSecret`).                                                                      |
| `GET`             | `/api/auth/*`, `/api/github/*`, `/api/vercel/teams`, `/api/github-stars` | OAuth, GitHub proxies, team picker, cached stars.                                                                                                    |

## GitHub Webhook — `/jules` Trigger

Wire a GitHub App or repo webhook to `https://<your-app>.vercel.app/api/webhooks/github`:

- Secret → `GITHUB_WEBHOOK_SECRET`
- Events → `Issues`, `Issue comments`
- Payload URL → that path; content type `application/json`.

Behavior:

- On `issues.opened` → `prompt = issue.body`.
- On `issue_comment.created` containing `/jules <prompt>` → `prompt = <prompt>`.
- If no prompt or no repo, the event is recorded in `webhook_events` and ignored (`{ ok: true, ignored: true }`).
- If `WEBHOOK_DEFAULT_USER_ID` is unset, the handler returns `500` (configure it to a real user to attribute webhook tasks).
- On success: `201 { task }` with `branchName` fallback and `webhookSource: { event, deliveryId }`.

Manual test:

```bash
curl -X POST https://<host>/api/webhooks/github \
  -H "X-GitHub-Event: issues" \
  -H "Content-Type: application/json" \
  -d '{"action":"opened","repository":{"html_url":"https://github.com/owner/repo"},"issue":{"body":"Fix the flaky parser test"},"sender":{"login":"octocat"}}'
```

Add ` -H "X-Hub-Signature-256: sha256=..."` when `GITHUB_WEBHOOK_SECRET` is set.

## Task & Database Model

> For the complete database schema, see [Database Schema](./docs/database.md).

### `tasks`

```
id PK
userId FK → users.id (CASCADE)
prompt, title?, repoUrl?
selectedAgent  default 'gateway'   // was 'claude'
selectedModel?                    // agent-specific label (e.g. claude-sonnet-4-5)
gatewayModel?                     // canonical Gateway model string (new)
installDependencies?  default false
maxDuration       default 60      // was 300 (MAX_SANDBOX_DURATION)
keepAlive?, enableBrowser?
status  'pending'|'processing'|'awaiting_approval'|'completed'|'error'|'stopped' default 'pending'

> `awaiting_approval` (new) — plan generated, waiting for user approval.
> Flow: pending → processing → awaiting_approval → processing → completed | error | stopped
> `error → (retry) → pending` for retrying failed/stopped tasks.

progress 0-100, logs jsonb LogEntry[], error?
branchName?, sandboxId?, agentSessionId?, sandboxUrl?, previewUrl?
prUrl?, prNumber?, prStatus? 'open'|'closed'|'merged', prMergeCommitSha?
mcpServerIds? jsonb string[]
webhookSource? jsonb  {}          // new — event/deliveryId
ingestCursor? timestamp           // new — last ingest write
parentTaskId? text FK → tasks.id  // new — for retry chains
autoFixAttempt  integer  default 0  // new — retry count for CI auto-fix
createdAt, updatedAt, completedAt?, deletedAt? (soft delete)
```

### `plans` (new — migration 0023)

```
id PK, taskId FK → tasks.id (CASCADE), version integer default 1,
content jsonb (Zod-validated against planSchema),
authoredBy 'agent'|'user', createdAt
```

### `steering_messages` (new — migration 0025)

```
id PK, taskId FK → tasks.id (CASCADE), seq integer, body text,
appliedAt timestamp?, createdAt
```

### `audio_summaries` (new — migration 0026)

```
id PK, taskId FK → tasks.id (CASCADE), blobUrl, transcript, durationSec?,
modelVersion, diffHash?, createdAt
```

### `pr_checks` (new — migration 0028)

```
id PK, taskId FK → tasks.id (CASCADE), checkRunId unique, conclusion, createdAt
```

### `metrics_daily` (new — migration 0029)

```
date PK, workspaceId?, tasksCreated, tasksCompleted, tasksFailed, totalCostCents
```

Other tables: `users` (`UNIQUE(provider, externalId)`), `accounts` (linked GitHub for Vercel users, `UNIQUE(userId, provider)`), `keys` (`UNIQUE(userId, provider)` with `enum ['anthropic','openai','cursor','gemini','aigateway']`), `task_messages` (`taskId FK CASCADE`, `role 'user'|'agent'`), `connectors`, `settings`, `webhook_events`.

Migrations live in `lib/db/migrations/` and are tracked in `lib/db/migrations/meta/_journal.json`. The latest migrations (`0023`–`0029`) add plans, task states, steering messages, audio summaries, task parent hierarchy, PR checks, and metrics tables.

## Security

This template ships with strict rules documented at the top of `AGENTS.md` — **follow them**:

- **All log statements use static strings only — never template literals with `${}`**. Example:

  ```ts
  // BAD: await logger.info(`Task created: ${taskId}`)
  // GOOD: await logger.info('Task created')
  ```

  Logs are displayed in the UI and returned in API responses — dynamic values leak IDs, paths, and credentials.

- `lib/utils/logging.ts:redactSensitiveInfo()` is a **backup** only (API keys, Bearer tokens, GitHub tokens, `teamId`/`projectId`/`Vercel` fields) — the primary defense is not logging dynamic values.
- Sensitive env vars **must not** reach the client. Only `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `NEXT_PUBLIC_VERCEL_CLIENT_ID`, `NEXT_PUBLIC_AUTH_PROVIDERS` are client-safe. Everything else (`SANDBOX_VERCEL_*`, `AI_GATEWAY_API_KEY`, `JWE_SECRET`, `ENCRYPTION_KEY`, `GITHUB_WEBHOOK_SECRET`, user tokens/keys) stays server-side and is encrypted at rest with `ENCRYPTION_KEY`/`JWE_SECRET` (`lib/crypto.ts`, `lib/jwe/*`).
- Search for violations before submitting:

  ```bash
  grep -r "logger\.(info|error|success|command)(\`.*\${" --include="*.ts" lib/ app/
  grep -r "console\.(log|error|warn|info)(\`.*\${" --include="*.ts" lib/ app/
  ```

## Development Scripts

```bash
pnpm dev            # next dev --webpack (http://localhost:3000)
pnpm build          # next build --turbopack
pnpm start          # next start
pnpm lint           # eslint
pnpm type-check     # tsc --noEmit
pnpm format         # prettier --write "**/*.{ts,tsx}"
pnpm format:check   # prettier --check "**/*.{ts,tsx}"
pnpm db:generate    # drizzle-kit generate  (writes lib/db/migrations/*.sql)
pnpm db:push        # drizzle-kit push      (applies migrations)
pnpm db:migrate     # drizzle-kit migrate
pnpm db:studio      # drizzle studio
```

Compliance checklist before a PR (from `AGENTS.md`):

- [ ] No `${}` in any `logger.*` / `console.*` user-facing log calls
- [ ] `pnpm format` + `pnpm format:check` pass
- [ ] `pnpm type-check` pass
- [ ] `pnpm lint` pass
- [ ] `pnpm build` pass
- [ ] `vercel.json` still `maxDuration: 10` on every function

## Project Structure

```
app/
  layout.tsx, page.tsx
  api/
    tasks/route.ts                      # GET/POST/DELETE — POST returns 201 in ≤3.5s
    tasks/[taskId]/route.ts             # GET/PATCH/DELETE (single task)
    tasks/[taskId]/start/route.ts       # Hobby async start (new)
    tasks/[taskId]/ingest-logs/route.ts # internal log ingestion (new)
    tasks/[taskId]/continue/route.ts    # follow-up (resumes VM if keepAlive)
    tasks/[taskId]/messages/route.ts
    tasks/[taskId]/{files,project-files,file-content,save-file,create-file,create-folder,delete-file,file-operation,discard-file-changes,diff,sync-changes,sync-pr,reset-changes,clear-logs,terminal,lsp,autocomplete,deployment,check-runs,pr,sandbox-health,start-sandbox,stop-sandbox,restart-dev}/
    cron/reap/route.ts                  # Hobby cron (new)
    webhooks/github/route.ts            # /jules trigger (new)
    api-keys/{route.ts,check/route.ts}  # Gateway-centric
    connectors/route.ts, github/*, vercel/teams, auth/*
  repos/[owner]/[repo]/, new/[owner]/[repo]/, tasks/[taskId]/,
components/
  task-form.tsx        # Gateway-only model matrix (gateway/claude/codex via Gateway)
  api-keys-dialog.tsx  # Gateway required, legacy providers collapsed
  home-page-content.tsx# calls /start immediately after /tasks
  task-details.tsx, task-chat.tsx, logs-pane.tsx, file-browser.tsx,
  plan-editor.tsx, steer-input.tsx, audio-player.tsx         # UI for plan editing, steering, audio
  connectors/, auth/, ui/, logos/, icons/
lib/
  constants.ts         # GATEWAY_BASE_URL, GATEWAY_DEFAULT_MODEL, GATEWAY_MODELS
  db/schema.ts         # tasks (+gatewayModel, webhookSource, ingestCursor, parentTaskId, autoFixAttempt, plans, steering_messages, audio_summaries, pr_checks, metrics_daily)
  db/client.ts, db/migrations/, db/users.ts, db/settings.ts
  sandbox/
    creation.ts        # Sandbox.create({ vcpus:2, timeout, clone, deps, branch })
    orchestrator.ts    # runPlannerPhase() + runExecutionPhase() + runTaskAsync()
    planner.ts         # runPlannerInSandbox — Gemini Pro read-only planning agent
    prompts/planner-system-prompt.md  # System prompt for the planner
    agents/
      index.ts         # AgentType gateway|claude|codex (+legacy gated)
      gateway.ts       # native Gateway agent (ai SDK + sandbox tools) — new
      claude.ts        # ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh
      codex.ts         # vercel-ai-gateway in ~/.codex/config.toml
      cursor.ts, copilot.ts, gemini.ts, opencode.ts # legacy (ENABLE_LEGACY_AGENTS)
    commands.ts, git.ts, package-manager.ts, port-detection.ts, sandbox-registry.ts, config.ts, types.ts
  utils/
    branch-name-generator.ts, title-generator.ts, commit-message-generator.ts # generateText('openai/gpt-5-nano') via Gateway
    task-logger.ts, logging.ts, rate-limit.ts, cookies.ts, id.ts
    errors.ts          # AppError, PlanSchemaError, SteerThrottledError, etc.
  plans/schema.ts      # Zod plan schema (goal, assumptions, steps, risk)
  audio/               # Audio summary generation (generate-summary.ts)
  session/, jwe/, crypto.ts, github/, vercel-client/, api-keys/, atoms/, hooks/
public/, scripts/, opensrc/, docs/
```

## Troubleshooting

- **`AI_GATEWAY_API_KEY is required`** — set it globally (`AI_GATEWAY_API_KEY=vck_...`) or per-user in the profile API Keys dialog (Gateway). Without it, branch/title/commit fall back to timestamps, then to agent failure (correct — every inference path requires Gateway).
- **Bonded 10s timeout on `/start`** — `POST /api/tasks/[taskId]/start` is capped at 10s. It creates the Sandbox and spawns the agent, then returns immediately; agent execution continues inside the VM. Do not re-introduce `after()`-forever in this path.
- **"Sandbox creation timed out, please retry"** — the Vercel Sandbox API create call has a bounded timeout (default 9s, up to 2 retries, configurable via `SANDBOX_CREATE_TIMEOUT_MS` / `SANDBOX_CREATE_RETRIES`). The VM ID is persisted to the task as soon as the sandbox exists, so a slow provision no longer leaves tasks stuck in `processing` without a sandbox.
- **Private repo clone fails** — ensure the user connected GitHub (`POST /api/auth/signin/github` or profile Connect) so `getUserGitHubToken()` can supply an authenticated clone URL.
- **Vite preview blocked** — `creation.ts` sets `vite.config.* → host: true` and adds it to `~/.gitignore_global`.
- **DB drift** — run `pnpm db:generate` then `pnpm db:push`. Never hand-edit tables outside Drizzle.

## What Changed from the Upstream Template

| Area          | Upstream                                                                                                           | This fork                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inference     | 6 provider matrix (Anthropic/OpenAI/Cursor/Gemini/Bearer×keys)                                                     | Gateway-only (`AI_GATEWAY_API_KEY` → `https://ai-gateway.vercel.sh`); Claude & Codex routed via `ANTHROPIC_BASE_URL` / `model_provider=vercel-ai-gateway`; new native `gateway` agent                                                                                                                                      |
| Task creation | `after()` x3 (branch/title + `processTaskWithTimeout` `Promise.race(timeout)`) — holds `maxDuration: 300` function | Bounded sync: fallback branch/title immediately + `Promise.race(..., 3500ms)` upgrade; no `after()`; ≤3.5s `201`                                                                                                                                                                                                           |
| Execution     | `processTask` / `continueTask` inside `after()`                                                                    | `lib/sandbox/orchestrator.ts:runPlannerPhase()` + `runExecutionPhase()` + `POST /api/tasks/[id]/start` (Hobby `10s`) and `POST /api/tasks/[id]/continue` (existing flow preserved)                                                                                                                                         |
| Sandbox       | `vcpus: 4`, `MAX_SANDBOX_DURATION 300`                                                                             | `vcpus: 2`, `MAX_SANDBOX_DURATION 60` (plus `lib/constants.ts:GATEWAY_*`)                                                                                                                                                                                                                                                  |
| Vercel        | `vercel.json { maxDuration: 300, crons: [] }`                                                                      | `{ maxDuration: 10 (×all routes), crons: [reap @ 5min, audio @ 10min, metrics @ daily 00:05 UTC] }`                                                                                                                                                                                                                        |
| DB            | `tasks: { selectedAgent default 'claude', maxDuration default 300 }`                                               | `+gatewayModel, +webhookSource, +ingestCursor, +parentTaskId, +autoFixAttempt`, default `gateway`/`60`, `awaiting_approval` status, new tables `plans`, `steering_messages`, `audio_summaries`, `pr_checks`, `metrics_daily` (migrations `0022`–`0029`)                                                                    |
| UI            | 6 agents + per-provider key checks                                                                                 | Gateway-focused picker (`gateway`/`claude`/`codex` all via Gateway), single Gateway key input, auto-`POST /start`, PlanEditor, SteerInput, AudioPlayer, Retry button                                                                                                                                                       |
| New routes    | —                                                                                                                  | `POST /api/tasks/[id]/start`, `POST /api/tasks/[id]/ingest-logs`, `POST /api/tasks/[id]/plan`, `POST /api/tasks/[id]/approve`, `POST /api/tasks/[id]/steer`, `POST /api/tasks/[id]/audio`, `POST /api/tasks/[id]/retry`, `GET /api/cron/reap`, `GET /api/cron/audio`, `GET /api/cron/metrics`, `POST /api/webhooks/github` |

## License

MIT — see `LICENSE`.

## Need Help?

- Vercel Sandbox docs: https://vercel.com/docs/vercel-sandbox
- Vercel AI Gateway: https://vercel.com/docs/ai-gateway
- Drizzle ORM: https://orm.drizzle.team/
- Next.js 16: https://nextjs.org/docs
