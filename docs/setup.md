# Setup Guide

This guide walks through running the Jules-style async coding agent locally for development and deploying it to Vercel for production use.

## Prerequisites

| Requirement               | Minimum               | Notes                                                                                                                                                                   |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**               | 20.x                  | Required by Next.js 16                                                                                                                                                  |
| **pnpm**                  | 9.x                   | Package manager (do **not** use npm or yarn — lock file is pnpm-specific)                                                                                               |
| **Vercel AI Gateway key** | `vck_...` or `gw_...` | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key for all model inference. Required for branch names, titles, commit messages, and the Gateway/planner agents |
| **GitHub OAuth App**      | —                     | For authentication and repo access. [Create one](https://github.com/settings/developers)                                                                                |
| **Postgres**              | Any Postgres          | [Neon](https://neon.tech) is recommended (auto-provisioned via Vercel deploy button)                                                                                    |
| **Vercel credentials**    | —                     | `SANDBOX_VERCEL_TOKEN`, `SANDBOX_VERCEL_TEAM_ID`, `SANDBOX_VERCEL_PROJECT_ID` — required for sandbox VM creation                                                        |

> If you only want to explore the code without running it, you can skip the OAuth and Gateway setup. The app will fall back to static branch names and titles.

---

## Local Development

### 1. Clone and install

```bash
git clone <this-repo>
cd <this-repo>
pnpm install
```

### 2. Create `.env.local`

Copy from the [Configuration Reference](./configuration.md) and fill in every required variable. A minimal example:

```bash
# Database
POSTGRES_URL=postgresql://user:pass@ep-cool-darkness-123456.us-east-2.aws.neon.tech/dbname

# Vercel Sandbox credentials
SANDBOX_VERCEL_TOKEN=vst_...
SANDBOX_VERCEL_TEAM_ID=team_...
SANDBOX_VERCEL_PROJECT_ID=proj_...

# Encryption (generate with openssl rand -base64 32 / openssl rand -hex 32)
JWE_SECRET=base64-encoded-32-byte-secret-here
ENCRYPTION_KEY=hex-encoded-32-byte-key-here

# Auth — at least one provider
NEXT_PUBLIC_AUTH_PROVIDERS=github
NEXT_PUBLIC_GITHUB_CLIENT_ID=Iv1.abc123...
GITHUB_CLIENT_SECRET=secret

# AI — Vercel AI Gateway
AI_GATEWAY_API_KEY=vck_...
```

### 3. Initialize the database

```bash
pnpm db:push
```

This applies all Drizzle migrations to your Postgres instance. Run this after pulling new changes if the schema has been updated.

### 4. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with GitHub (or Vercel), then create a task.

> **Do not run multiple dev servers** against the same `.next` directory or port. If port 3000 is in use, set `PORT=3001` or kill the existing process.

### Local development workflow

1. `pnpm dev` — runs `next dev --webpack`
2. Make code changes — hot reload is active
3. Run quality checks before committing:
   ```bash
   pnpm format      # prettier --write
   pnpm type-check  # tsc --noEmit
   pnpm lint        # eslint
   pnpm build       # next build --turbopack (production verification)
   ```
4. If you change the database schema:
   ```bash
   pnpm db:generate  # creates a new migration file
   pnpm db:push      # applies it locally
   ```

See [Development Guide](./development.md) for more details on the workflow.

---

## Production Deployment (Vercel)

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](<https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fcoding-agent-template&env=SANDBOX_VERCEL_TEAM_ID,SANDBOX_VERCEL_PROJECT_ID,SANDBOX_VERCEL_TOKEN,JWE_SECRET,ENCRYPTION_KEY&envDescription=Required+environment+variables+for+the+coding+agent+template.+You+must+also+configure+at+least+one+OAuth+provider+(GitHub+or+Vercel)+after+deployment.+Optional+API+keys+can+be+added+later.&stores=%5B%7B%22type%22%3A%22postgres%7D%7D%5D&project-name=coding-agent-template&repository-name=coding-agent-template>)

What happens automatically:

- A **Neon Postgres** database is provisioned and `POSTGRES_URL` is set
- You are prompted for the required environment variables (see [Configuration Reference](./configuration.md))
- After deploy, you must configure at least one OAuth provider

### Post-deploy configuration

1. **OAuth provider** — In your Vercel project dashboard → Settings → Environment Variables, add:
   - GitHub: `GITHUB_CLIENT_SECRET` (you already created the OAuth App; set `NEXT_PUBLIC_GITHUB_CLIENT_ID` as well)
   - Or Vercel: `VERCEL_CLIENT_SECRET` (set `NEXT_PUBLIC_VERCEL_CLIENT_ID` as well)
   - Set callback URLs to `https://your-app.vercel.app/api/auth/github/callback` (or `/callback/vercel`)

2. **AI Gateway** — Add `AI_GATEWAY_API_KEY` as a secret environment variable

3. **Optional: Metrics dashboard** — To enable `/admin/metrics`, set `NEXT_PUBLIC_ADMIN_ENABLED=true`

4. **Optional: Audio changelogs** — To enable MP3 generation, add `ELEVENLABS_API_KEY` and optionally `ELEVENLABS_VOICE_ID`

5. **Optional: Webhook security** — Set `GITHUB_WEBHOOK_SECRET` to verify webhook payloads. Without it, the `/jules` webhook endpoint will still work but won't verify signatures (not recommended for production).

6. **Optional: Legacy agents** — Set `ENABLE_LEGACY_AGENTS=1` to allow Copilot, Cursor, Gemini, or OpenCode agents (disabled by default)

7. **Optional: Private npm packages** — Add `NPM_TOKEN` for private package access in sandboxes

### Cron jobs

On Vercel, crons are defined in `vercel.json` and run automatically:

| Cron path           | Schedule           | Purpose                                                |
| ------------------- | ------------------ | ------------------------------------------------------ |
| `/api/cron/reap`    | Every 5 minutes    | Recovers stale `processing` tasks whose sandboxes died |
| `/api/cron/audio`   | Every 10 minutes   | Generates audio changelogs for completed tasks         |
| `/api/cron/metrics` | Daily at 00:05 UTC | Aggregates daily task metrics                          |

> Vercel Hobby allows a maximum of 3 crons. This project uses all 3. Adding more will prevent deployment.

---

## Troubleshooting

### `AI_GATEWAY_API_KEY is required`

Set it globally as an environment variable or per-user in the app's API Keys dialog (Profile → API Keys → provider: `aigateway`). Without it, branch names and titles fall back to nanoid-based strings, and agents will fail to run.

### Sandbox creation fails

- Verify `SANDBOX_VERCEL_TOKEN` is valid and has scope to create sandboxes on the specified team/project
- Check that `SANDBOX_VERCEL_TEAM_ID` and `SANDBOX_VERCEL_PROJECT_ID` are correct
- Ensure your Vercel account has Sandbox access (Hobby/Free tier is sufficient)

### Private repo clone fails

- Ensure the user who created the task has connected their GitHub account (Profile → Connect GitHub)
- The app uses the user's OAuth token to clone private repos

### OAuth redirect mismatch

- The callback URL must exactly match what's registered with the OAuth provider
- For local dev: `http://localhost:3000/api/auth/github/callback`
- For production: `https://your-app.vercel.app/api/auth/github/callback`

### Port already in use

```bash
pnpm dev -- -p 3001
```

### Database schema drift

```bash
pnpm db:generate  # detect schema changes, create migration
pnpm db:push      # apply migrations to the database
```

### Webhooks not triggering

- Verify `GITHUB_WEBHOOK_SECRET` matches between the GitHub App settings and your environment variable
- Check the GitHub App has `issues` and `issue comments` events subscribed
- Test with `curl -H "x-vercel-cron: 1" http://localhost:3000/api/webhooks/github`
