# Configuration Reference

This project uses environment variables for all configuration. Variables are categorized below by requirement level. The `.env*` files are **gitignored** — never commit `.env.local`.

## Required Environment Variables

### Infrastructure

| Variable                    | Where used                                                               | How to get it                                                                    |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `POSTGRES_URL`              | `drizzle.config.ts`, `lib/db/client.ts`, `scripts/migrate-production.ts` | Auto-set on Vercel via Neon integration; locally, any Postgres URL (e.g. Docker) |
| `SANDBOX_VERCEL_TOKEN`      | `lib/sandbox/creation.ts`, all sandbox routes                            | [Vercel Dashboard → Tokens](https://vercel.com/account/tokens)                   |
| `SANDBOX_VERCEL_TEAM_ID`    | Same as above                                                            | Vercel Dashboard → Team settings → General                                       |
| `SANDBOX_VERCEL_PROJECT_ID` | Same as above                                                            | Vercel Dashboard → Project → Settings → General                                  |
| `JWE_SECRET`                | `lib/jwe/encrypt.ts`, `lib/jwe/decrypt.ts`                               | `openssl rand -base64 32`                                                        |
| `ENCRYPTION_KEY`            | `lib/crypto.ts`                                                          | `openssl rand -hex 32` (32 bytes, hex-encoded)                                   |

### Authentication (at least one provider)

| Variable                                                | Meaning                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_AUTH_PROVIDERS`                            | `"github"`, `"vercel"`, or `"github,vercel"` (default: `"github"`)                                     |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App client ID and secret. Callback URL: `https://<host>/api/auth/github/callback`         |
| `NEXT_PUBLIC_VERCEL_CLIENT_ID` / `VERCEL_CLIENT_SECRET` | Vercel OAuth integration client ID and secret. Callback URL: `https://<host>/api/auth/callback/vercel` |

**Creating a GitHub OAuth App:**

1. Go to https://github.com/settings/developers → New OAuth App
2. Set Authorization callback URL to `http://localhost:3000/api/auth/github/callback` (local) or `https://your-app.vercel.app/api/auth/github/callback` (production)
3. Copy the Client ID and Client Secret into your environment variables

**Creating a Vercel OAuth integration:**

1. Go to https://vercel.com/dashboard → Team → Integrations → Create
2. Set Redirect URL to `http://localhost:3000/api/auth/callback/vercel` (local) or `https://your-app.vercel.app/api/auth/callback/vercel` (production)
3. Copy the Client ID and Client Secret into your environment variables

### AI Inference (Vercel AI Gateway)

| Variable             | Meaning                                                                                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (`vck_...` or `gw_...`). This is the **global fallback** used for branch name generation, task titles, commit messages, the planner agent (Gemini Pro), and the native Gateway agent. **Or** set per-user in the app's Profile → API Keys dialog (provider: `aigateway`, stored encrypted). |

> Without `AI_GATEWAY_API_KEY`, the app falls back to nanoid-based branch names and titles, and agent execution will fail. Every inference path routes through AI Gateway — no direct Anthropic/OpenAI/Gemini keys are needed for the default `gateway` agent.

## Optional Environment Variables

| Variable                    | Default                | Meaning                                                                                                                                                              |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_SANDBOX_DURATION`      | `60`                   | Sandbox VM lifetime in minutes (`lib/constants.ts`). Original template defaulted to `300`; trimmed for Vercel Hobby's 10-second function timeout.                    |
| `MAX_MESSAGES_PER_DAY`      | `5`                    | Tasks + follow-ups per user per day (`lib/utils/rate-limit.ts`)                                                                                                      |
| `NPM_TOKEN`                 | —                      | Private npm access token for sandboxed environments                                                                                                                  |
| `GITHUB_WEBHOOK_SECRET`     | —                      | HMAC secret for verifying `POST /api/webhooks/github` payloads (`x-hub-signature-256`). If unset, signature verification is skipped (not recommended for production) |
| `WEBHOOK_DEFAULT_USER_ID`   | —                      | User ID to attribute `/jules` webhook tasks to when the webhook has no session. Required if you enable the GitHub webhook trigger without per-install user mapping   |
| `INGEST_TOKEN`              | —                      | Bearer token for `POST /api/tasks/[taskId]/ingest-logs` if called outside Vercel cron                                                                                |
| `CRON_SECRET`               | —                      | Bearer token for `GET /api/cron/reap` and other cron routes if called outside Vercel cron                                                                            |
| `ENABLE_LEGACY_AGENTS`      | —                      | Set to `1` to allow `copilot`, `cursor`, `gemini`, `opencode` agents. Default: blocked with a helpful error message                                                  |
| `NEXT_PUBLIC_ADMIN_ENABLED` | —                      | Set to `true` to enable the `/admin/metrics` dashboard                                                                                                               |
| `ELEVENLABS_API_KEY`        | —                      | ElevenLabs API key for MP3 audio generation of changelog summaries. If unset, audio summaries are stored as text files                                               |
| `ELEVENLABS_VOICE_ID`       | `21m00Tcm4TlvDq8ikWAM` | Custom voice ID for ElevenLabs TTS                                                                                                                                   |

## `.env.local` Template

```bash
# ─── Database ───
POSTGRES_URL=postgresql://user:password@host:5432/dbname

# ─── Vercel Sandbox ───
SANDBOX_VERCEL_TOKEN=your-vercel-token
SANDBOX_VERCEL_TEAM_ID=your-team-id
SANDBOX_VERCEL_PROJECT_ID=your-project-id

# ─── Encryption ───
JWE_SECRET=your-jwe-secret-base64
ENCRYPTION_KEY=your-encryption-key-hex

# ─── Authentication ───
NEXT_PUBLIC_AUTH_PROVIDERS=github
NEXT_PUBLIC_GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# ─── AI Gateway ───
AI_GATEWAY_API_KEY=your-gateway-key

# ─── Optional ───
MAX_SANDBOX_DURATION=60
MAX_MESSAGES_PER_DAY=5
GITHUB_WEBHOOK_SECRET=your-webhook-secret
WEBHOOK_DEFAULT_USER_ID=your-default-user-id
ENABLE_LEGACY_AGENTS=1
NEXT_PUBLIC_ADMIN_ENABLED=true
ELEVENLABS_API_KEY=your-elevenlabs-key
```

## Client-Safe vs Server-Only Variables

Only `NEXT_PUBLIC_`-prefixed variables are exposed to the browser. Everything else stays server-side:

| Client-safe (public)           | Server-only (never expose)  |
| ------------------------------ | --------------------------- |
| `NEXT_PUBLIC_AUTH_PROVIDERS`   | `POSTGRES_URL`              |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | `SANDBOX_VERCEL_TOKEN`      |
| `NEXT_PUBLIC_VERCEL_CLIENT_ID` | `SANDBOX_VERCEL_TEAM_ID`    |
|                                | `SANDBOX_VERCEL_PROJECT_ID` |
|                                | `AI_GATEWAY_API_KEY`        |
|                                | `JWE_SECRET`                |
|                                | `ENCRYPTION_KEY`            |
|                                | `GITHUB_CLIENT_SECRET`      |
|                                | `VERCEL_CLIENT_SECRET`      |
|                                | `GITHUB_WEBHOOK_SECRET`     |
|                                | `WEBHOOK_DEFAULT_USER_ID`   |
|                                | `NPM_TOKEN`                 |
|                                | `CRON_SECRET`               |
|                                | `INGEST_TOKEN`              |
|                                | `ELEVENLABS_API_KEY`        |
|                                | Per-user encrypted API keys |

User-provided API keys (stored in the `keys` table) are encrypted at rest via `lib/crypto.ts` using `ENCRYPTION_KEY` and are never exposed to the client.
