# Architecture

An in-depth look at how this Jules-style async coding agent works, from the Hobby-tier constraints through the sandbox VM execution model.

## Layered Architecture

| Layer           | Technology                                                           | Why                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compute**     | Vercel Sandbox (`@vercel/sandbox`)                                   | Isolated VM that outlives the serverless function — essential for long-running agent work. The serverless function only _starts_ the VM (<10s), then returns. |
| **Inference**   | Vercel AI Gateway (`ai` SDK `generateText` with `openai/gpt-5-nano`) | Single key, model routing by string prefix (e.g. `anthropic/claude-sonnet-4-5`), no per-provider secrets needed for the default `gateway` agent               |
| **Async model** | Two-phase task creation + sandbox execution + cron reaper            | Vercel Hobby has no Background Queues/Workflows. The sandbox VM is the queue; cron jobs handle recovery                                                       |
| **Database**    | Neon Postgres + Drizzle ORM                                          | Provisioned automatically via the Vercel Deploy Button. Schema is defined in `lib/db/schema.ts`, migrations in `lib/db/migrations/`                           |
| **Auth**        | GitHub / Vercel OAuth (`arctic` + `jose` JWE cookies)                | Required for repo cloning and user identity                                                                                                                   |
| **UI**          | Next.js 16, React 19, Tailwind CSS, shadcn/ui                        | Same as upstream — no changes to the UI framework                                                                                                             |

## Task Lifecycle State Machine

The `tasks.status` column drives the entire task flow. The `awaiting_approval` status is new in this fork (enabled by migration `0024_task_states.sql`):

```
                     ┌─────────────┐
                     │    pending  │
                     └──────┬──────┘
                            │
                            ▼
                     ┌─────────────┐
   (legacy agents)   │  processing  │◄─────┐
                     └──────┬──────┘      │
                            │             │
            (gateway agent)│             │
                            ▼             │
                     ┌─────────────────┐   │
                     │ awaiting_approval│  │
                     └──────┬──────┬───┘   │
                            │      │       │
              (approved)    │      │ (not  │
                            ▼      │ approved)
                     ┌─────────────┐      │
                     │  processing  │      │
                            │      │       │
             (complete)     │      │ (error)
                            ▼      ▼       ▼
                     ┌─────────────┐  ┌─────────┐  ┌────────┐
                     │  completed  │  │  error  │  │stopped │
                     └─────────────┘  └────┬────┘  └────────┘
                                          │
                              (retry)     │
                                          ▼
                                     ┌─────────────┐
                                     │    pending  │
                                     └─────────────┘
```

### Status values

| Status              | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `pending`           | Task created, not yet started (or freshly retried)                                 |
| `processing`        | Sandbox VM is running, agent is executing                                          |
| `awaiting_approval` | Plan generated, waiting for user to approve in the PlanEditor (Gateway agent only) |
| `completed`         | Agent finished, changes pushed, PR created (if applicable)                         |
| `error`             | Agent or sandbox failed; task can be retried                                       |
| `stopped`           | User cancelled the task; sandbox killed                                            |

## Request Lifecycle

### Legacy agents (claude, codex, copilot, cursor, gemini, opencode) — single-phase

1. `POST /api/tasks` — validates the body (`insertTaskSchema`), inserts a task row with fallback branch name and title, attempts AI-generated branch name and title (bounded 3.5s race via Gateway), returns `201`
2. Client immediately calls `POST /api/tasks/[taskId]/start`
3. `start` route creates the sandbox, sets `status: 'processing'`, and calls `runTaskAsync()` (fire-and-forget via `after()`)
4. `runTaskAsync` — for legacy agents, creates sandbox → runs `executeAgentInSandbox` → pushes changes → creates PR → updates status to `completed` or `error`
5. UI polls `GET /api/tasks/[taskId]` every 5s, messages every 3s

### Gateway agent — two-phase (plan → approve → execute)

1. `POST /api/tasks` — same as above, but for `selectedAgent: 'gateway'`, triggers `runPlannerPhase()` via `after()`
2. **Phase 1 — Planner**: `runPlannerPhase()` creates a short-lived sandbox (5-min timeout, `vcpus: 2`), calls `runPlannerInSandbox()` which uses Gemini Pro (`google/gemini-2.5-pro` via Gateway) with read-only tools to explore the repo and produce a structured plan → plan stored in `plans` table → task status → `awaiting_approval` → sandbox shut down
3. **Phase 2 — Approval**: User reviews/edits/approves the plan in the `PlanEditor` component. `POST /api/tasks/[taskId]/approve` calls `runExecutionPhase()`, which creates a new sandbox → runs the agent with the approved plan appended to the prompt → pushes → creates PR → optionally generates audio summary → sets status to `completed`
4. UI displays the plan editor during `awaiting_approval`, and the full task details during `processing`/`completed`

### Follow-up (continue)

- `POST /api/tasks/[taskId]/continue` — inserts a user message into `task_messages`, resumes the sandbox if `keepAlive` is set, re-runs the agent with full message history
- The Gateway agent picks up steering messages between tool calls (see [Task Steering](./features/steering.md))

## Component Hierarchy (UI)

```
app/layout.tsx
└── SharedHeader
    ├── RepoPicker (header left)
    ├── TaskActions (header right)
    └── SignIn / UserMenu

app/tasks/[taskId]/page.tsx (SSR wrapper)
└── TaskPageClient (client component)
    ├── SharedHeader
    ├── PlanEditor          ← shows during awaiting_approval
    ├── AudioPlayer         ← shows during completed
    ├── TaskDetails         ← full task view (files, diffs, chat, preview)
    │   ├── TaskChat        ← message history + SteerInput
    │   ├── FileBrowser     ← local/remote/all file views
    │   ├── FileDiffViewer  ← Monaco editor diff viewer
    │   ├── CreatePRDialog  ← create/merge/close PRs
    │   └── Terminal        ← sandbox terminal
    └── LogsPane            ← streaming task logs
```

## Sandbox Lifecycle

```
provisionSandbox()
  ├─ Sandbox.create (bounded: SANDBOX_CREATE_TIMEOUT_MS, default 9s; SANDBOX_CREATE_RETRIES, default 2)
  ├─ registerSandbox()
  └─ persist tasks.sandboxId immediately (before any clone/install)
setupSandbox()
  ├─ git clone --depth 1 <repo> → /vercel/sandbox/project
  ├─ checkout branch (fallback nanoid, may upgrade to AI-generated)
  ├─ optional: install dependencies
  └─ optional: start dev server (detected port)
execute agent (Gateway CLI or AI SDK-based)
  ├─ agent edits files, runs commands, tests
  ├─ pushChangesToBranch() → git add → git commit → git push origin <branch>
  ├─ optionally create PR via Octokit
  ├─ optionally generate audio summary
  └─ shutdownSandbox() (or keep alive if keepAlive=true)
```

The create call is split from repo setup (`createSandbox()` = `provisionSandbox()` + `setupSandbox()`). `sandboxId` is written to the task row as soon as the VM exists, so healers/reapers never misclassify a live sandbox as a stuck task while clone/install are still running. Fire-and-forget triggers (`/start`, internal `run-phase`) use `after()` to keep the provisioning work alive after the HTTP response.

Sandbox configuration (`lib/sandbox/types.ts`):

- `timeout`: `${maxDuration}m` (default 60 min; planner phase uses 5 min)
- `vcpus`: 2 (down from upstream's 4, to fit Hobby constraints)
- `runtime`: `node22`
- `ports`: detected from the repo (via `detectPortFromRepo`)

## Data Flow by Agent Type

| Agent                                  | Planning                                                                                      | Execution                                      | API key needed                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| `gateway`                              | `runPlannerPhase` → `runPlannerInSandbox` (Gemini Pro) → plan → approve → `runExecutionPhase` | `executeGatewayInSandbox` (GPT-5-nano via SDK) | `AI_GATEWAY_API_KEY`                          |
| `claude`                               | `runTaskAsync` → `executeClaudeInSandbox` (Claude Code, routed via Gateway)                   | Same                                           | `AI_GATEWAY_API_KEY` (as `ANTHROPIC_API_KEY`) |
| `codex`                                | `runTaskAsync` → `executeCodexInSandbox` (Codex CLI, routed via Gateway)                      | Same                                           | `AI_GATEWAY_API_KEY` (as `OPENAI_API_KEY`)    |
| `copilot`/`cursor`/`gemini`/`opencode` | `runTaskAsync` → respective CLI (requires `ENABLE_LEGACY_AGENTS=1`)                           | Same                                           | Varies (legacy)                               |

## Cron Jobs

Vercel Hobby allows a maximum of 3 crons. This project uses all 3, defined in `vercel.json`:

| Cron    | Schedule                      | Handler                         | Purpose                                                                                                                                    |
| ------- | ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Reaper  | `*/5 * * * *` (every 5 min)   | `app/api/cron/reap/route.ts`    | Queries tasks with `status='processing'` and `updatedAt < now() - 5m`. Probes the sandbox; if gone, logs `Reaper could not reach sandbox`. |
| Audio   | `*/10 * * * *` (every 10 min) | `app/api/cron/audio/route.ts`   | Finds completed tasks without audio summaries; generates one per run                                                                       |
| Metrics | `5 0 * * *` (daily 00:05 UTC) | `app/api/cron/metrics/route.ts` | Aggregates daily task counts (created/completed/failed) into `metrics_daily`                                                               |

All cron routes are authorized via the `x-vercel-cron` header (set automatically by Vercel) or a `Bearer` token (`CRON_SECRET` or `SANDBOX_VERCEL_TOKEN`). In non-production, they are accessible without auth for manual testing.
