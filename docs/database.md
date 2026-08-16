# Database Schema

The database uses **Neon Postgres** with **Drizzle ORM** for schema definition and query building. Schema is defined in `lib/db/schema.ts` with Zod validation schemas alongside each table. Migrations live in `lib/db/migrations/` and are tracked in `lib/db/migrations/meta/_journal.json`.

## Entity Relationship Diagram

```
users
  │ id PK
  │
  ├── accounts (linked GitHub for Vercel users)
  ├── keys (encrypted API keys per provider)
  ├── settings (per-user overrides)
  ├── connectors (MCP server configs)
  ├── tasks (1 user → many tasks)
  │    └── task_messages (many)
  │    └── plans (many, versioned)
  │    └── steering_messages (many, seq)
  │    └── audio_summaries (many)
  │    └── pr_checks (many)
  │    └── webhook_events (many, via FK)
  │
  task_messages
  plans
  steering_messages
  audio_summaries
  pr_checks
  webhook_events
  metrics_daily
```

---

## Table Definitions

### `users`

User profiles — the primary OAuth account (GitHub or Vercel) that created the user.

| Column          | Type                      | Description                       |
| --------------- | ------------------------- | --------------------------------- |
| `id`            | `text` PK                 | Internal user ID (12-char nanoid) |
| `provider`      | `enum('github','vercel')` | Primary auth provider             |
| `external_id`   | `text`                    | External ID from OAuth provider   |
| `access_token`  | `text`                    | Encrypted OAuth access token      |
| `refresh_token` | `text`                    | Encrypted OAuth refresh token     |
| `scope`         | `text`                    | OAuth scope string                |
| `username`      | `text`                    | Username (required)               |
| `email`         | `text`                    | Email address                     |
| `name`          | `text`                    | Display name                      |
| `avatar_url`    | `text`                    | Avatar image URL                  |
| `created_at`    | `timestamp`               | Created (default `now()`)         |
| `updated_at`    | `timestamp`               | Last updated                      |
| `last_login_at` | `timestamp`               | Last login timestamp              |

**Index**: `users_provider_external_id_idx` (unique on `provider, external_id`)

### `accounts`

Additional linked accounts (currently GitHub only — for Vercel users connecting GitHub).

| Column             | Type             | Description                     |
| ------------------ | ---------------- | ------------------------------- |
| `id`               | `text` PK        | 12-char nanoid                  |
| `user_id`          | `text` FK        | References `users.id` (cascade) |
| `provider`         | `enum('github')` | Always `github` (default)       |
| `external_user_id` | `text`           | GitHub user ID                  |
| `access_token`     | `text`           | Encrypted OAuth token           |
| `refresh_token`    | `text`           | Encrypted OAuth refresh token   |
| `expires_at`       | `timestamp`      | Token expiry                    |
| `scope`            | `text`           | OAuth scope                     |
| `username`         | `text`           | GitHub username                 |
| `created_at`       | `timestamp`      | Created                         |
| `updated_at`       | `timestamp`      | Last updated                    |

**Index**: `accounts_user_id_provider_idx` (unique on `user_id, provider`)

### `keys`

User's encrypted API keys for various services.

| Column       | Type                                                       | Description                     |
| ------------ | ---------------------------------------------------------- | ------------------------------- |
| `id`         | `text` PK                                                  | 12-char nanoid                  |
| `user_id`    | `text` FK                                                  | References `users.id` (cascade) |
| `provider`   | `enum('anthropic','openai','cursor','gemini','aigateway')` | Key provider                    |
| `value`      | `text`                                                     | Encrypted key value             |
| `created_at` | `timestamp`                                                | Created                         |
| `updated_at` | `timestamp`                                                | Last updated                    |

**Index**: `keys_user_id_provider_idx` (unique on `user_id, provider`)

### `tasks`

The central table — one row per coding task.

| Column                 | Type                             | Description                                                                   |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `id`                   | `text` PK                        | 12-char nanoid                                                                |
| `user_id`              | `text` FK                        | Owner (cascade delete)                                                        |
| `prompt`               | `text`                           | The instruction for the agent                                                 |
| `title`                | `text`                           | Task title (may upgrade from fallback)                                        |
| `repo_url`             | `text`                           | Repository clone URL                                                          |
| `selected_agent`       | `text` default `'gateway'`       | Agent type (`gateway`, `claude`, `codex`, etc.)                               |
| `selected_model`       | `text`                           | Agent-specific model label                                                    |
| `gateway_model`        | `text`                           | Canonical Gateway model string                                                |
| `install_dependencies` | `boolean` default `false`        | Whether to run `npm install` in sandbox                                       |
| `max_duration`         | `integer` default `60`           | Sandbox lifetime in minutes                                                   |
| `keep_alive`           | `boolean` default `false`        | Keep sandbox alive after completion                                           |
| `enable_browser`       | `boolean` default `false`        | Install browser tooling in sandbox                                            |
| `status`               | `enum(...)` default `'pending'`  | `pending`, `processing`, `awaiting_approval`, `completed`, `error`, `stopped` |
| `progress`             | `integer`                        | 0–100                                                                         |
| `logs`                 | `jsonb`                          | Array of `LogEntry` (`{ type, message, timestamp }`)                          |
| `error`                | `text`                           | Error message if failed                                                       |
| `branch_name`          | `text`                           | Git branch name                                                               |
| `sandbox_id`           | `text`                           | Vercel Sandbox ID                                                             |
| `agent_session_id`     | `text`                           | Agent session (for Cursor)                                                    |
| `sandbox_url`          | `text`                           | Preview URL for sandbox dev server                                            |
| `preview_url`          | `text`                           | Vercel deployment preview URL                                                 |
| `pr_url`               | `text`                           | GitHub PR URL                                                                 |
| `pr_number`            | `integer`                        | PR number                                                                     |
| `pr_status`            | `enum('open','closed','merged')` | PR status                                                                     |
| `pr_merge_commit_sha`  | `text`                           | Merge commit SHA                                                              |
| `mcp_server_ids`       | `jsonb`                          | Array of attached MCP server IDs                                              |
| `webhook_source`       | `jsonb`                          | `{ event, deliveryId }` for webhook-created tasks                             |
| `ingest_cursor`        | `timestamp`                      | Last log ingestion write timestamp                                            |
| `parent_task_id`       | `text` FK                        | Self-reference for retry chains                                               |
| `auto_fix_attempt`     | `integer` default `0`            | Retry count for auto-fix loops                                                |
| `created_at`           | `timestamp`                      | Created                                                                       |
| `updated_at`           | `timestamp`                      | Last updated                                                                  |
| `completed_at`         | `timestamp`                      | When task reached terminal status                                             |
| `deleted_at`           | `timestamp`                      | Soft delete timestamp                                                         |

### `task_messages`

Chat messages between user and agent for each task.

| Column       | Type                   | Description                     |
| ------------ | ---------------------- | ------------------------------- |
| `id`         | `text` PK              | 12-char nanoid                  |
| `task_id`    | `text` FK              | References `tasks.id` (cascade) |
| `role`       | `enum('user','agent')` | Who sent the message            |
| `content`    | `text`                 | Message content                 |
| `created_at` | `timestamp`            | Created                         |

### `plans` (migration 0023)

Versioned plans generated by the planner agent.

| Column        | Type                   | Description                                          |
| ------------- | ---------------------- | ---------------------------------------------------- |
| `id`          | `text` PK              | 12-char nanoid                                       |
| `task_id`     | `text` FK              | References `tasks.id` (cascade)                      |
| `version`     | `integer` default `1`  | Incremental version number                           |
| `content`     | `jsonb`                | The plan object (Zod-validated against `planSchema`) |
| `authored_by` | `enum('agent','user')` | Who created this version                             |
| `created_at`  | `timestamp`            | Created                                              |

**Indexes**: `plans_task_id_idx`, `plans_task_version_idx` (unique on `task_id, version`)

### `steering_messages` (migration 0025)

Mid-run guidance messages sent by the user to the Gateway agent.

| Column       | Type        | Description                                |
| ------------ | ----------- | ------------------------------------------ |
| `id`         | `text` PK   | 12-char nanoid                             |
| `task_id`    | `text` FK   | References `tasks.id` (cascade)            |
| `seq`        | `integer`   | Monotonically increasing per task          |
| `body`       | `text`      | The steering message                       |
| `applied_at` | `timestamp` | When the agent applied it (null = pending) |
| `created_at` | `timestamp` | Created                                    |

**Indexes**: `steering_task_idx`, `steering_task_seq_idx` (unique on `task_id, seq`)

### `audio_summaries` (migration 0026)

AI-narrated changelog audio for completed tasks.

| Column          | Type        | Description                               |
| --------------- | ----------- | ----------------------------------------- |
| `id`            | `text` PK   | 12-char nanoid                            |
| `task_id`       | `text` FK   | References `tasks.id` (cascade)           |
| `blob_url`      | `text`      | URL to Vercel Blob (MP3 or TXT)           |
| `transcript`    | `text`      | Full transcript text                      |
| `duration_sec`  | `integer`   | Estimated speaking time                   |
| `model_version` | `text`      | Model used (e.g. `openai/gpt-5-nano:tts`) |
| `diff_hash`     | `text`      | SHA-256 of diff (for cache invalidation)  |
| `created_at`    | `timestamp` | Created                                   |

**Indexes**: `audio_task_idx`, `audio_task_diff_model_idx` (unique on `task_id, diff_hash, model_version`)

### `pr_checks` (migration 0028)

Records of GitHub check run conclusions for PR-based tasks.

| Column         | Type          | Description                                      |
| -------------- | ------------- | ------------------------------------------------ |
| `id`           | `text` PK     | 12-char nanoid                                   |
| `task_id`      | `text` FK     | References `tasks.id` (cascade)                  |
| `check_run_id` | `text` unique | GitHub check run ID                              |
| `conclusion`   | `text`        | Check run conclusion (e.g. `success`, `failure`) |
| `created_at`   | `timestamp`   | Created                                          |

**Index**: `pr_checks_task_idx`

### `metrics_daily` (migration 0029)

Daily aggregated metrics, populated by the `/api/cron/metrics` cron job.

| Column             | Type                  | Description                        |
| ------------------ | --------------------- | ---------------------------------- |
| `date`             | `date` PK             | UTC date                           |
| `workspace_id`     | `text`                | Currently unused (reserved)        |
| `tasks_created`    | `integer` default `0` | Tasks created that day             |
| `tasks_completed`  | `integer` default `0` | Tasks reaching `completed`         |
| `tasks_failed`     | `integer` default `0` | Tasks reaching `error`             |
| `total_cost_cents` | `integer` default `0` | Cost tracking (currently always 0) |

### `connectors`

MCP server configurations.

| Column                | Type                                                        | Description                               |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `id`                  | `text` PK                                                   | 12-char nanoid                            |
| `user_id`             | `text` FK                                                   | Owner (cascade)                           |
| `name`                | `text`                                                      | Display name                              |
| `description`         | `text`                                                      | Optional description                      |
| `type`                | `enum('local','remote')` default `'remote'`                 | Local (command) or remote (URL) MCP       |
| `base_url`            | `text`                                                      | URL for remote MCP (optional)             |
| `oauth_client_id`     | `text`                                                      | OAuth client ID for remote MCP (optional) |
| `oauth_client_secret` | `text`                                                      | Encrypted OAuth secret (optional)         |
| `command`             | `text`                                                      | Command for local MCP (optional)          |
| `env`                 | `text`                                                      | Encrypted environment variables JSON      |
| `status`              | `enum('connected','disconnected')` default `'disconnected'` | Connection status                         |
| `created_at`          | `timestamp`                                                 | Created                                   |
| `updated_at`          | `timestamp`                                                 | Last updated                              |

### `settings`

Per-user overrides for environment variables (e.g. higher `MAX_MESSAGES_PER_DAY`).

| Column       | Type        | Description                             |
| ------------ | ----------- | --------------------------------------- |
| `id`         | `text` PK   | 12-char nanoid                          |
| `user_id`    | `text` FK   | Owner (cascade)                         |
| `key`        | `text`      | Setting key (e.g. `maxSandboxDuration`) |
| `value`      | `text`      | Setting value (text-encoded)            |
| `created_at` | `timestamp` | Created                                 |
| `updated_at` | `timestamp` | Last updated                            |

**Index**: `settings_user_id_key_idx` (unique on `user_id, key`)

### `webhook_events`

Records of all incoming GitHub webhook events.

| Column       | Type        | Description                                       |
| ------------ | ----------- | ------------------------------------------------- |
| `id`         | `text` PK   | 12-char nanoid                                    |
| `provider`   | `text`      | Always `github`                                   |
| `event_type` | `text`      | `issues` or `issue_comment`                       |
| `payload`    | `jsonb`     | Full webhook payload                              |
| `task_id`    | `text` FK   | Task created from this event (set null on delete) |
| `created_at` | `timestamp` | Created                                           |

---

## Migrations

Migrations are auto-generated by Drizzle Kit (`pnpm db:generate`) and tracked in `lib/db/migrations/meta/_journal.json`. They are applied with `pnpm db:push` (local) or automatically on Vercel deploy.

| #         | Tag                | What it adds                                                                                                   |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| 0000–0021 | Various            | Core tables: `users`, `accounts`, `keys`, `tasks`, `task_messages`, `settings`, `connectors`, `webhook_events` |
| 0022      | `swift_black_crow` | Gateway agent support columns on `tasks` (`gateway_model`, `webhook_source`, `ingest_cursor`)                  |
| 0023      | `plans`            | `plans` table — versioned task plans                                                                           |
| 0024      | `task_states`      | Marker migration for `awaiting_approval` status (app-level enum; no DDL)                                       |
| 0025      | `steering`         | `steering_messages` table — mid-run guidance                                                                   |
| 0026      | `audio_summaries`  | `audio_summaries` table — audio changelogs                                                                     |
| 0027      | `task_parent`      | `parent_task_id` self-FK + `auto_fix_attempt` on `tasks`                                                       |
| 0028      | `pr_checks`        | `pr_checks` table — check run tracking                                                                         |
| 0029      | `metrics`          | `metrics_daily` table — daily aggregation                                                                      |

### Drizzle ORM patterns

- Tables defined with `pgTable()` — columns use snake_case in SQL, camelCase in TypeScript (`id: text('id')`)
- Zod schemas (`insertTaskSchema`, `selectTaskSchema`) provide validation for API inputs and type-safe selects
- `$type<T>()` on `jsonb` columns ensures TypeScript types match (e.g. `logs: jsonb('logs').$type<LogEntry[]>`)
- Enums defined inline: `text('status', { enum: ['pending', 'processing', ...] })`
- Self-referencing foreign keys: `parentTaskId: text('parent_task_id').references(() => tasks.id)`
- All user-scoped tables have `userId` FK with `onDelete: 'cascade'`

### Database operations

| Command            | What it does                                                   |
| ------------------ | -------------------------------------------------------------- |
| `pnpm db:push`     | Apply pending migrations to the database (fast, dev-oriented)  |
| `pnpm db:generate` | Generate migration SQL from schema changes                     |
| `pnpm db:migrate`  | Run migrations (production-oriented, creates a `_sql` journal) |
| `pnpm db:studio`   | Open Drizzle Studio web UI for browsing data                   |
