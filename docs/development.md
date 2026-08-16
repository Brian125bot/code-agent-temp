# Development Guide

## Package Manager

This project uses **pnpm**. Do not use npm or yarn — the lockfile is pnpm-specific (`pnpm-lock.yaml`).

```bash
# Install pnpm (if not already)
npm install -g pnpm@latest

# Install dependencies
pnpm install
```

## Available Scripts

| Script              | Command                            | Description                                                      |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | `next dev --webpack`               | Start the Next.js dev server at `http://localhost:3000`          |
| `pnpm build`        | `next build --turbopack`           | Production build (verification step — always run before pushing) |
| `pnpm start`        | `next start`                       | Start a production server                                        |
| `pnpm lint`         | `eslint`                           | Run ESLint across the project                                    |
| `pnpm type-check`   | `tsc --noEmit`                     | TypeScript type checking (no output)                             |
| `pnpm format`       | `prettier --write "**/*.{ts,tsx}"` | Format all TS/TSX files                                          |
| `pnpm format:check` | `prettier --check "**/*.{ts,tsx}"` | Verify formatting without writing                                |
| `pnpm db:generate`  | `drizzle-kit generate`             | Generate migration SQL from schema changes                       |
| `pnpm db:push`      | `drizzle-kit push`                 | Apply migrations to the database (fast, dev-oriented)            |
| `pnpm db:migrate`   | `drizzle-kit migrate`              | Run migrations (production-oriented)                             |
| `pnpm db:studio`    | `drizzle-kit studio`               | Open Drizzle Studio web UI                                       |

## Quality Enforcement Workflow

Before every commit and definitely before every PR:

```bash
pnpm format        # Format first
pnpm type-check    # Fix any type errors
pnpm lint          # Fix any lint errors
pnpm build         # Verify production build
```

All four must pass. Do not skip or ignore errors.

## Local Development

### Starting the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is in use:

```bash
pnpm dev -- -p 3001
```

Or set the `PORT` environment variable.

### Working with the database

1. After cloning, set up your `.env.local` (see [Configuration Reference](./configuration.md))
2. Apply migrations:

```bash
pnpm db:push
```

3. When you modify the schema in `lib/db/schema.ts`:

```bash
pnpm db:generate  # creates a new migration in lib/db/migrations/
pnpm db:push      # applies it to your local DB
```

4. Browse data:

```bash
pnpm db:studio
```

### Debugging

- **Server-side logs**: Use `console.error()` for server-side debugging. These appear in the terminal/server logs, **not** in the UI, and do not expose data to users.
- **User-facing logs**: All `logger.info()`, `logger.error()`, `logger.success()`, `logger.command()`, `console.log()`, `console.error()`, `console.warn()` calls are displayed in the UI and returned in API responses. **These must use static strings only** — see [Security Guidelines](./security.md).
- **Sandbox logs**: Task execution logs stream to the `LogsPane` component in the UI. Logs are stored in `tasks.logs` (jsonb array of `LogEntry`).

## Adding New API Routes

### Rules for Vercel Hobby

1. **Every function must declare `export const maxDuration = 10`** — Hobby's maximum is 10 seconds
2. **Add the route to `vercel.json`** under `functions` if it's a long-running route
3. **Do not use `after()` to hold the function open** — `after()` is for fire-and-forget background work only
4. **Heavy work must happen inside the sandbox VM**, not in the serverless function

### Route file structure

Routes follow Next.js 16 App Router conventions:

```
app/api/tasks/[taskId]/<route-name>/route.ts
```

Each route file must export HTTP method handlers (`GET`, `POST`, `PATCH`, `DELETE`).

### Auth pattern

```typescript
import { getServerSession } from '@/lib/session/get-server-session'

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ... route logic
}
```

### Error handling

Use the `AppError` class from `lib/utils/errors.ts`:

```typescript
import { AppError } from '@/lib/utils/errors'

try {
  // ... operation
} catch (error) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  console.error('Error doing something:', error) // server-side only
  return NextResponse.json({ error: 'Failed to do something', code: 'INTERNAL' }, { status: 500 })
}
```

### Cron route auth pattern

```typescript
function isCronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const auth = req.headers.get('authorization') || ''
  const token = process.env.CRON_SECRET || process.env.SANDBOX_VERCEL_TOKEN
  if (token && auth === `Bearer ${token}`) return true
  if (process.env.NODE_ENV !== 'production') return true
  return false
}
```

## Adding New Database Columns

1. Edit the table definition in `lib/db/schema.ts`
2. Generate a migration:

```bash
pnpm db:generate
```

3. Review the generated migration in `lib/db/migrations/`
4. Apply locally:

```bash
pnpm db:push
```

5. Commit the migration file — it will be applied automatically on Vercel deploy

> **Never hand-edit tables outside of Drizzle.** Use the schema → generate → push workflow.

## Adding New Agent Types

1. Add the agent to the `AgentType` union in `lib/sandbox/agents/index.ts`
2. Implement `execute<AgentName>InSandbox()` in `lib/sandbox/agents/<agent-name>.ts`
3. Add the dispatch case in `executeAgentInSandbox()`
4. Add the agent entry to `lib/sandbox/types.ts` `SandboxConfig` if it needs special config
5. For legacy agents: add the `ENABLE_LEGACY_AGENTS` gate check
6. Update the UI model matrix in `components/task-details.tsx`

## Adding New Cron Jobs

> **Warning**: Vercel Hobby allows a maximum of **3 cron jobs** per project. This project currently uses all 3 (`reap`, `audio`, `metrics`). Adding a 4th will prevent deployment.

If you remove an existing cron to make room:

1. Create the new cron route in `app/api/cron/<name>/route.ts`
2. Add both routes to `vercel.json` under `crons`:

```json
{
  "crons": [
    { "path": "/api/cron/reap", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/audio", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/metrics", "schedule": "5 0 * * *" }
  ]
}
```

## Testing

This project does not have a formal test suite. Verification is done via:

```bash
pnpm build          # Production build must succeed
pnpm type-check     # No TypeScript errors
pnpm lint           # No ESLint errors
```

For local testing of specific features:

- **Webhook trigger**: `curl -H "x-vercel-cron: 1" http://localhost:3000/api/cron/reap`
- **API routes**: Use the browser UI or `curl` with the JWE cookie
- **Sandbox execution**: Create a test task and watch the logs stream in the UI

## Code Style

- **No semicolons** (Prettier config: `"semi": false`)
- **Single quotes** (Prettier config: `"singleQuote": true`)
- **Print width**: 120 characters
- **Trailing commas**: all
- **2-space indentation**

Run `pnpm format` before committing to auto-format.

## File Structure

See the [README](../README.md#project-structure) for the full structure. Key directories:

```
app/
  api/              # API routes (Next.js App Router)
  tasks/            # Task pages
  admin/            # Admin pages (metrics)
  repos/            # Repository pages

components/
  ui/               # shadcn/ui components
  task-*.tsx        # Task UI components
  *.tsx             # Shared components

lib/
  db/               # Database (schema, client, migrations)
  sandbox/          # Sandbox VM lifecycle and agent execution
  sandbox/agents/   # Agent implementations
  sandbox/prompts/  # System prompts for agents
  utils/            # Utilities (logging, rate-limit, id generation)
  audio/            # Audio summary generation
  plans/            # Plan schema and types
  session/          # Auth/session management
  github/           # GitHub API client and token management
  jwe/              # JWE encryption/decryption
  hooks/            # React hooks
  atoms/            # Jotai state
```
