# Security Guidelines

## Logging Policy — Static Strings Only

**All log statements MUST use static strings. NEVER include dynamic values, regardless of severity.**

Logs in this application are displayed directly in the UI and returned in API responses. Dynamic values can expose sensitive information (user IDs, file paths, credentials, repository URLs, branch names, etc.) to end users.

### Examples

```typescript
// BAD — never do this
await logger.info(`Task created: ${taskId}`)
await logger.error(`Failed to process ${filename}`)
console.log(`User ${userId} logged in`)
console.error(`Error for ${provider}:`, error)

// GOOD — use static strings
await logger.info('Task created')
await logger.error('Failed to process file')
console.log('User logged in')
console.error('Error occurred:', error)
```

### Applies to

- `logger.info()`, `logger.error()`, `logger.success()`, `logger.command()`, `logger.updateProgress()`
- `console.log()`, `console.error()`, `console.warn()`, `console.info()`

### Server-side debugging

For detailed debugging that should **never** reach users, use `console.error`:

```typescript
console.error('Detailed error for debugging:', error)
// This appears in server logs, not in user-facing logs
```

Still avoid logging credentials even in server-side logs.

### Checking for violations

```bash
# Check for logger statements with template literals
grep -rn "logger\.\(info\|error\|success\|command\)(\`.*\${" --include="*.ts" lib/ app/

# Check for console statements with template literals
grep -rn "console\.\(log\|error\|warn\|info\)(\`.*\${" --include="*.ts" lib/ app/
```

## Credential Categories

### Never log (server-side only, never to client)

| Variable                    | What                                  |
| --------------------------- | ------------------------------------- |
| `SANDBOX_VERCEL_TOKEN`      | Vercel API token for sandbox creation |
| `SANDBOX_VERCEL_TEAM_ID`    | Vercel team identifier                |
| `SANDBOX_VERCEL_PROJECT_ID` | Vercel project identifier             |
| `AI_GATEWAY_API_KEY`        | Vercel AI Gateway API key             |
| `ANTHROPIC_API_KEY`         | Anthropic API key (legacy)            |
| `OPENAI_API_KEY`            | OpenAI API key (legacy)               |
| `GEMINI_API_KEY`            | Google Gemini API key (legacy)        |
| `CURSOR_API_KEY`            | Cursor API key (legacy)               |
| `GH_TOKEN` / `GITHUB_TOKEN` | User's GitHub token                   |
| `JWE_SECRET`                | JWE cookie signing secret             |
| `ENCRYPTION_KEY`            | Encryption key for API keys at rest   |
| `GITHUB_CLIENT_SECRET`      | GitHub OAuth client secret            |
| `VERCEL_CLIENT_SECRET`      | Vercel OAuth client secret            |
| `GITHUB_WEBHOOK_SECRET`     | GitHub webhook HMAC secret            |
| `WEBHOOK_DEFAULT_USER_ID`   | Default user ID for webhook tasks     |
| `NPM_TOKEN`                 | Private npm token                     |
| `CRON_SECRET`               | Bearer token for cron routes          |
| `INGEST_TOKEN`              | Bearer token for log ingestion        |
| `ELEVENLABS_API_KEY`        | ElevenLabs TTS API key                |
| `ELEVENLABS_VOICE_ID`       | Custom voice ID                       |

### Client-safe (can be `NEXT_PUBLIC_`)

Only these variables should be exposed to the browser:

| Variable                       | Purpose                         |
| ------------------------------ | ------------------------------- |
| `NEXT_PUBLIC_AUTH_PROVIDERS`   | Available auth providers        |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | GitHub OAuth client ID (public) |
| `NEXT_PUBLIC_VERCEL_CLIENT_ID` | Vercel OAuth client ID (public) |
| `NEXT_PUBLIC_ADMIN_ENABLED`    | Toggle for admin metrics page   |

### Per-user keys (stored in database, encrypted)

API keys set by users via Profile → API Keys are stored in the `keys` table:

- Encrypted at rest using `ENCRYPTION_KEY` (`lib/crypto.ts`)
- Decrypted only on the server during agent execution
- Never sent to the client

## Encryption

### API key encryption (`lib/crypto.ts`)

- Uses AES-256-GCM with `ENCRYPTION_KEY`
- Each key is encrypted with a random IV and auth tag
- Stored as `base64(iv:ciphertext:tag)` in the `keys.value` column

### Session management (`lib/jwe/`)

- OAuth tokens are stored in a JWE-encrypted cookie (`_user_session_`)
- Uses `JWE_SECRET` for signing/encryption
- Cookie is `HttpOnly` — inaccessible from client-side JavaScript

## OAuth Flows

### GitHub OAuth

1. User clicks "Sign in with GitHub"
2. Redirected to `https://github.com/login/oauth/authorize` with `client_id`
3. GitHub redirects to `/api/auth/github/callback` with `code`
4. Server exchanges `code` for access token via `arctic` library
5. Server creates/updates user record, decrypts/encrypts token
6. Sets JWE-encrypted session cookie

### Vercel OAuth

Same flow but through Vercel's OAuth integration at `/api/auth/callback/vercel`.

### Linked accounts

Vercel-authenticated users can additionally connect their GitHub account via `/api/auth/github/signin`. This stores an `accounts` row with the user's GitHub token, used for repo cloning and PR creation.

## Webhook Security

### GitHub webhooks (`POST /api/webhooks/github`)

- Verifies `x-hub-signature-256` HMAC header when `GITHUB_WEBHOOK_SECRET` is set
- Without the secret, signature verification is skipped (development convenience — must set in production)
- Only processes `issues` and `issue_comment` events
- Extracts `/jules <prompt>` from issue comments (must start with `/jules`)
- Requires `WEBHOOK_DEFAULT_USER_ID` to attribute tasks when no session exists

### Cron authorization

Cron routes (`reap`, `audio`, `metrics`) are protected by:

1. `x-vercel-cron` header (automatically set by Vercel)
2. `Bearer CRON_SECRET` or `Bearer SANDBOX_VERCEL_TOKEN`
3. In `NODE_ENV !== 'production'`, auth is bypassed for manual testing

## Rate Limiting

- `MAX_MESSAGES_PER_DAY` (default: 5) limits tasks + follow-up messages per user per day
- Enforced in `POST /api/tasks` via `checkRateLimit()` (`lib/utils/rate-limit.ts`)
- Returns `429` with `{ error, message, remaining, total, resetAt }`

## Compliance Checklist

Before submitting changes, verify:

- [ ] No template literals with `${}` in any `logger.*` / `console.*` user-facing log calls
- [ ] `pnpm format` and `pnpm format:check` pass
- [ ] `pnpm type-check` passes (no TypeScript errors)
- [ ] `pnpm lint` passes (no ESLint errors)
- [ ] `pnpm build` passes (production build succeeds)
- [ ] `vercel.json` still has `maxDuration: 10` on every function
- [ ] No sensitive environment variables exposed to the client
- [ ] All API keys encrypted at rest using `ENCRYPTION_KEY`
- [ ] OAuth tokens stored in JWE-encrypted cookies
- [ ] Webhook signature verification enabled in production
- [ ] At most 3 cron jobs (Vercel Hobby limit)
