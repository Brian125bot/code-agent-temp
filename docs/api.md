# API Reference

All task-related routes require **authentication** — a valid JWE cookie (`_user_session_`) set during OAuth sign-in. Tasks are scoped to the authenticated user's `userId` with soft delete (`deletedAt IS NULL`).

## Error Response Format

All routes return errors in a consistent format following the `AppError` pattern (`lib/utils/errors.ts`):

```json
{
  "error": "Human-readable message",
  "code": "UPPER_SNAKE_CASE_ERROR_CODE",
  "status": 400
}
```

| Code                | Status | Meaning                                           |
| ------------------- | ------ | ------------------------------------------------- |
| `UNAUTHENTICATED`   | 401    | No valid session                                  |
| `NOT_FOUND`         | 404    | Resource doesn't exist or belongs to another user |
| `INVALID_BODY`      | 400    | Missing or malformed request body                 |
| `INVALID_STATE`     | 400    | Task is in wrong state for this operation         |
| `STEER_THROTTLED`   | 429    | Too many steering messages (cooldown period)      |
| `AUDIO_NOT_READY`   | 400    | Task hasn't completed yet                         |
| `PLAN_SCHEMA_ERROR` | 400    | Plan body doesn't match Zod schema                |
| `RATE_LIMITED`      | 429    | Daily task/message limit exceeded                 |
| `INTERNAL`          | 500    | Unexpected server error                           |

## Rate Limiting

- `MAX_MESSAGES_PER_DAY` (default: 5) limits tasks + follow-ups per user per day
- Checked in `POST /api/tasks` via `checkRateLimit()` (`lib/utils/rate-limit.ts`)
- Returns `429` with `{ error, message, remaining, total, resetAt }` when exceeded

---

## Tasks

### `GET /api/tasks`

List the authenticated user's tasks (excluding soft-deleted).

**Response (200):**

```json
{
  "tasks": [Task[]]
}
```

Tasks are ordered by `createdAt DESC` (newest first).

### `POST /api/tasks`

Create a new task. Returns `201` within **≤3.5 seconds** (Hobby-safe — does not hold the function open).

**Request body (`insertTaskSchema`):**

```typescript
{
  id?: string            // optional; 12-char nanoid generated if absent
  prompt: string         // required — the instruction for the agent
  repoUrl?: string       // clone URL (https://github.com/owner/repo[.git])
  selectedAgent?: 'gateway' | 'claude' | 'codex' | 'copilot' | 'cursor' | 'gemini' | 'opencode'
                        // default: 'gateway'
  selectedModel?: string // agent-specific model label (e.g. 'claude-sonnet-4-5')
  gatewayModel?: string  // canonical Gateway model string (preferred for audit)
  installDependencies?: boolean  // default: false
  maxDuration?: number   // minutes; default: MAX_SANDBOX_DURATION (60)
  keepAlive?: boolean    // keep VM alive after completion (for follow-ups)
  enableBrowser?: boolean // install agent-browser + Chromium + skill file
  mcpServerIds?: string[]
  branchName?: string    // optional; fallback generated with nanoid
  title?: string         // optional; fallback generated from prompt
}
```

**How it works:**

1. Validates body against `insertTaskSchema`
2. Checks rate limit (`MAX_MESSAGES_PER_DAY`)
3. Inserts task with fallback `branchName` and `title`
4. If `AI_GATEWAY_API_KEY` is set, races AI-generated branch name and title (bounded 3.5s timeout)
5. For `gateway` agent with a `repoUrl`, triggers `runPlannerPhase()` via `after()`
6. Returns `201 { task }`

**Response (201):**

```json
{
  "task": Task
}
```

### `GET /api/tasks/[taskId]`

Fetch a single task with its latest plan and audio summary.

**Response (200):**

```json
{
  "task": Task,
  "plan": Plan | null,
  "audioSummary": AudioSummary | null
}
```

### `PATCH /api/tasks/[taskId]`

Currently supports `action: 'stop'` — kills the sandbox and sets status to `stopped`.

**Request body:**

```json
{
  "action": "stop"
}
```

**Response (200):** `{ message: "Task stopped successfully", task: Task }`

**Response (400):** `{ error: "Task can only be stopped when it is in progress" }` — if status is not `processing`

### `DELETE /api/tasks/[taskId]`

Soft-delete (sets `deletedAt`). Does not kill sandboxes.

**Response (200):** `{ message: "Task deleted successfully" }`

### `DELETE /api/tasks?action=completed,failed,stopped`

Bulk hard-delete by status, scoped to the authenticated user.

**Query params:** `action` (comma-separated list of statuses: `completed`, `failed`, `stopped`)

**Response (200):** `{ message: "... task(s) deleted successfully", deletedCount: N }`

---

## Task Sub-Routes

### `POST /api/tasks/[taskId]/start`

**Hobby async start** — creates the sandbox and kicks off execution. Fire-and-forget; the UI calls this immediately after `POST /api/tasks`.

- Creates the sandbox via `provisionSandbox()` + `setupSandbox()`
- Sets `task.status = 'processing'`, writes `sandboxId` immediately after the VM exists (before clone/install)
- Calls `runTaskAsync()` (or `runPlannerPhase()` for gateway agent) via `after()`
- Returns immediately with `{ task, message: 'Task started' }`

For `gateway` agent tasks, `POST /api/tasks` already triggers `runPlannerPhase` via `after()`, so `/start` is primarily used by legacy agents and for retry scenarios.

### `POST /api/tasks/[taskId]/continue`

Follow-up message for an active or completed task.

**Request body:**

```json
{
  "message": "Also add tests for the edge cases we discussed"
}
```

- Inserts the message into `task_messages` (`role: 'user'`)
- If `keepAlive` is set and sandbox exists, resumes execution
- Re-runs the selected agent with full message history

### `GET /api/tasks/[taskId]/messages`

Returns all task messages (chat history).

**Response (200):**

```json
{
  "messages": TaskMessage[]
}
```

### `POST /api/tasks/[taskId]/plan`

Create a new plan version for a task. Used by the `PlanEditor` when editing a plan. Plan body is validated against `planSchema` (Zod).

**Request body:** [Plan schema](../features/planning.md#plan-schema)

**Response (201):** `{ plan: Plan }`

**Response (400):** `{ error: "...", code: "PLAN_SCHEMA_ERROR" }` — with field-level validation errors

### `POST /api/tasks/[taskId]/approve`

Approve a plan and start execution.

- Sets `task.status = 'processing'`
- Triggers `runExecutionPhase(taskId)` via `after()`
- Returns `{ ok: true }` immediately

**Response (400):** `{ error: "Task is not awaiting approval", code: "INVALID_STATE" }` — if not in `awaiting_approval` status

### `POST /api/tasks/[taskId]/steer`

Inject a mid-run steering message for a `processing` task.

**Request body:**

```json
{
  "message": "Use a simpler approach — just add a boolean flag instead of refactoring the class hierarchy"
}
```

- Max 2000 characters
- 5-second cooldown per task (returns `429` with `Retry-After: 5` header)
- Only works when `task.status === 'processing'`
- Stores message in `steering_messages` table; Gateway agent polls and applies it

See [Task Steering](./features/steering.md) for full details.

### `POST /api/tasks/[taskId]/audio`

Generate or fetch an audio changelog for a completed task.

- `GET` — returns the latest audio summary (or null)
- `POST` — queues generation (202) or returns cached result (200)

See [Audio Changelog](./features/audio-summaries.md) for full details.

### `POST /api/tasks/[taskId]/retry`

Retry a failed (`error`) or stopped (`stopped`) task.

- Resets `status` to `pending`, clears `error`, resets `progress`
- For `gateway` agent: calls `runPlannerPhase()` (fresh plan, re-enters plan-approval flow)
- For legacy agents: calls `runTaskAsync()` (direct execution)
- Uses `after()` for background execution

**Response (200):** `{ task: Task }`

**Response (400):** `{ error: "Can only retry failed or stopped tasks", code: "INVALID_STATE" }`

### Sandbox management

| Method | Path                                 | Description                                                              |
| ------ | ------------------------------------ | ------------------------------------------------------------------------ |
| `GET`  | `/api/sandboxes`                     | List your active sandboxes (`sandboxId IS NOT NULL`)                     |
| `GET`  | `/api/tasks/[taskId]/sandbox-health` | Probe sandbox liveness via `sandbox.runCommand('pwd')`                   |
| `POST` | `/api/tasks/[taskId]/start-sandbox`  | Recreate sandbox if it died                                              |
| `POST` | `/api/tasks/[taskId]/stop-sandbox`   | Kill sandbox, set `sandboxId = NULL`                                     |
| `POST` | `/api/tasks/[taskId]/restart-dev`    | Restart dev server in sandbox                                            |
| `POST` | `/api/tasks/[taskId]/terminal`       | Execute a shell command in the sandbox                                   |
| `POST` | `/api/tasks/[taskId]/ingest-logs`    | Internal log ingestion (authorized by `x-vercel-cron` or `INGEST_TOKEN`) |

### Files, diffs, and PRs

| Method | Path                                       | Description                                |
| ------ | ------------------------------------------ | ------------------------------------------ | -------- |
| `GET`  | `/api/tasks/[taskId]/files`                | List all files in the repo                 |
| `GET`  | `/api/tasks/[taskId]/project-files`        | Same as files, with mode parameter         |
| `GET`  | `/api/tasks/[taskId]/file-content`         | Read file content (`filename`, `mode=local | remote`) |
| `GET`  | `/api/tasks/[taskId]/diff`                 | Get file diff (`filename`, `mode=local     | remote`) |
| `POST` | `/api/tasks/[taskId]/save-file`            | Save file in local mode                    |
| `POST` | `/api/tasks/[taskId]/create-file`          | Create a new file                          |
| `POST` | `/api/tasks/[taskId]/create-folder`        | Create a new folder                        |
| `POST` | `/api/tasks/[taskId]/delete-file`          | Delete a file                              |
| `POST` | `/api/tasks/[taskId]/file-operation`       | Generic file operation                     |
| `POST` | `/api/tasks/[taskId]/discard-file-changes` | Discard local changes to a file            |
| `POST` | `/api/tasks/[taskId]/reset-changes`        | Reset all local changes                    |
| `GET`  | `/api/tasks/[taskId]/sync-changes`         | Sync changes between local and remote      |
| `POST` | `/api/tasks/[taskId]/sync-pr`              | Sync PR status from GitHub                 |
| `POST` | `/api/tasks/[taskId]/clear-logs`           | Clear task logs                            |
| `GET`  | `/api/tasks/[taskId]/deployment`           | Check for Vercel deployment                |
| `GET`  | `/api/tasks/[taskId]/check-runs`           | Fetch GitHub check runs                    |
| `POST` | `/api/tasks/[taskId]/pr`                   | Get or create PR                           |
| `POST` | `/api/tasks/[taskId]/close-pr`             | Close the PR                               |
| `POST` | `/api/tasks/[taskId]/reopen-pr`            | Reopen the PR                              |
| `POST` | `/api/tasks/[taskId]/merge-pr`             | Merge the PR                               |
| `GET`  | `/api/tasks/[taskId]/pr-comments`          | Fetch PR comments                          |
| `GET`  | `/api/tasks/[taskId]/autocomplete`         | Autocomplete file paths                    |
| `POST` | `/api/tasks/[taskId]/lsp`                  | Language server protocol proxy             |

All file operations work against `PROJECT_DIR = /vercel/sandbox/project` inside the VM. PR operations use the Octokit client with the user's decrypted GitHub token (`getUserGitHubToken()`).

---

## Cron Jobs

| Method | Path                | Schedule        | Description                                    |
| ------ | ------------------- | --------------- | ---------------------------------------------- |
| `GET`  | `/api/cron/reap`    | Every 5 min     | Recovers stale `processing` tasks              |
| `GET`  | `/api/cron/audio`   | Every 10 min    | Generates audio changelogs for completed tasks |
| `GET`  | `/api/cron/metrics` | Daily 00:05 UTC | Aggregates daily task metrics                  |

All cron routes accept `GET` and `POST`. Authorized by `x-vercel-cron` header, or `Bearer CRON_SECRET`, or `Bearer SANDBOX_VERCEL_TOKEN`. In non-production, accessible without auth:

```bash
curl -H "x-vercel-cron: 1" http://localhost:3000/api/cron/reap
```

---

## Webhooks

### `POST /api/webhooks/github`

The `/jules` trigger — creates tasks from GitHub issues and comments.

**Events**: `Issues` (`issues.opened`) and `Issue comments` (`issue_comment.created`)

**Trigger patterns:**

- On `issues.opened`: `prompt = issue.body`
- On `issue_comment.created` with `/jules <prompt>`: `prompt = <prompt>`

**Verification**: HMAC signature check via `x-hub-signature-256` if `GITHUB_WEBHOOK_SECRET` is set.

**Response (201):**

```json
{
  "task": Task,
  "webhookSource": { "event": "issues", "deliveryId": "..." }
}
```

**Response (200):** `{ ok: true, ignored: true }` — when no prompt or repo can be extracted

**Response (500):** If `WEBHOOK_DEFAULT_USER_ID` is not set (must be configured)

**Manual test:**

```bash
curl -X POST https://<host>/api/webhooks/github \
  -H "X-GitHub-Event: issues" \
  -H "Content-Type: application/json" \
  -d '{"action":"opened","repository":{"html_url":"https://github.com/owner/repo"},"issue":{"body":"Fix the flaky parser test"},"sender":{"login":"octocat"}}'
```

---

## Keys & Connectors

### API Keys

| Method   | Path                    | Description          |
| -------- | ----------------------- | -------------------- |
| `GET`    | `/api/api-keys`         | List user's API keys |
| `POST`   | `/api/api-keys`         | Create a new API key |
| `DELETE` | `/api/api-keys?id=<id>` | Delete an API key    |

Keys are stored encrypted via `lib/crypto.ts` using `ENCRYPTION_KEY`. The `keys.provider` column accepts `'anthropic'`, `'openai'`, `'cursor'`, `'gemini'`, or `'aigateway'`.

### API Keys Check

`GET /api/api-keys/check?agent=&model=` — returns `{ hasKey, provider, agentName }`. Gateway-centric: all agents route through `aigateway` unless using `copilot` with `getUserGitHubToken()`.

### Connectors (MCP servers)

| Method   | Path                      | Description                |
| -------- | ------------------------- | -------------------------- |
| `GET`    | `/api/connectors`         | List user's MCP connectors |
| `POST`   | `/api/connectors`         | Create a new connector     |
| `DELETE` | `/api/connectors?id=<id>` | Delete a connector         |

Supports both `local` (command-based) and `remote` (URL-based with OAuth) MCP servers. Connector env vars and OAuth secrets are encrypted at rest.

### Auth & GitHub proxies

| Method     | Path                          | Description                                   |
| ---------- | ----------------------------- | --------------------------------------------- |
| `GET/POST` | `/api/auth/*`                 | OAuth callbacks, session management           |
| `GET`      | `/api/auth/signin/github`     | Trigger GitHub sign-in                        |
| `GET`      | `/api/auth/signin/vercel`     | Trigger Vercel sign-in                        |
| `GET`      | `/api/auth/signout`           | Sign out                                      |
| `GET`      | `/api/auth/github/status`     | Check GitHub connection status                |
| `GET`      | `/api/auth/github/disconnect` | Disconnect GitHub                             |
| `GET`      | `/api/auth/info`              | Get current session info                      |
| `GET`      | `/api/auth/rate-limit`        | Check rate limit status                       |
| `GET`      | `/api/auth/callback/vercel`   | Vercel OAuth callback                         |
| `GET`      | `/api/github/*`               | GitHub API proxies (user, repos, orgs, stars) |
| `GET`      | `/api/vercel/teams`           | List Vercel teams                             |

---

## Admin Routes

### `GET /admin/metrics` (page route)

**Gate**: `NEXT_PUBLIC_ADMIN_ENABLED=true` — returns 404 otherwise.

Displays the last 30 days of task metrics with a 7-day summary table, bar chart, and expandable 30-day view. See [Metrics Dashboard](./features/metrics.md).

### `GET /api/ingest-logs`

**Note**: This route is at `POST /api/tasks/[taskId]/ingest-logs` — see Task Sub-Routes above.
