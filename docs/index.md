# Jules-Style Async Agent — Documentation

An analogue of **Jules** — the asynchronous coding agent — rebuilt from the Vercel Coding Agent Template to run on **Vercel Hobby (Free Tier)** with **Vercel AI Gateway** as the sole inference provider.

Give it a repo + a task and it works **detached**: clones, branches, edits code inside a Vercel Sandbox VM, streams logs, pushes, and is wired for PR automation. No direct Anthropic/OpenAI/Gemini keys — every model call is routed through **AI Gateway** (`https://ai-gateway.vercel.sh`) with a single `AI_GATEWAY_API_KEY`.

![Coding Agent Template Screenshot](../screenshot.png)

---

## Table of Contents

### Getting Started

- [Setup Guide](./setup.md) — Local development and Vercel deployment step by step
- [Configuration Reference](./configuration.md) — Complete environment variable reference with `.env.local` template

### Understanding the System

- [Architecture](./architecture.md) — How the async two-phase execution model works
- [Agent Configuration](./agents.md) — Gateway, Claude, Codex, and legacy agents
- [Database Schema](./database.md) — All tables, columns, migrations, and Drizzle patterns

### Features

- [Plan Approval Workflow](./features/planning.md) — Two-phase plan → approve → execute flow
- [Task Steering](./features/steering.md) — Guide a running agent mid-execution
- [Audio Changelog](./features/audio-summaries.md) — AI-narrated changelog for completed tasks
- [Metrics Dashboard](./features/metrics.md) — Daily task metrics and admin view

### Reference

- [API Reference](./api.md) — Complete REST API documentation
- [Development Guide](./development.md) — Scripts, code style, and contributing workflow
- [Security Guidelines](./security.md) — Logging policy, credential handling, and compliance checklist

---

## Quick Start

**Deploy to Vercel** (one-click):

[![Deploy with Vercel](https://vercel.com/button)](<https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fcoding-agent-template&env=SANDBOX_VERCEL_TEAM_ID,SANDBOX_VERCEL_PROJECT_ID,SANDBOX_VERCEL_TOKEN,JWE_SECRET,ENCRYPTION_KEY&envDescription=Required+environment+variables+for+the+coding+agent+template.+You+must+also+configure+at+least+one+OAuth+provider+(GitHub+or+Vercel)+after+deployment.+Optional+API+keys+can+be+added+later.&stores=%5B%7B%22type%22%3A%22postgres%22%7D%5D&project-name=coding-agent-template&repository-name=coding-agent-template>)

**Or run locally:**

```bash
git clone <this-repo>
cd <this-repo>
pnpm install
cp .env.example .env.local  # fill in your values
pnpm db:push
pnpm dev
```

See the [Setup Guide](./setup.md) for detailed instructions on obtaining all required credentials.

---

## Key Concepts

- **Detached execution**: Tasks run inside Vercel Sandbox VMs that outlive serverless functions. The HTTP response returns immediately; work continues in the VM.
- **AI Gateway as sole provider**: All inference (branch names, titles, commit messages, planning, execution) routes through `https://ai-gateway.vercel.sh`. Only `AI_GATEWAY_API_KEY` is needed.
- **Plan → Approve → Execute** (Gateway agent): The agent first produces a structured plan, waits for your approval, then executes — giving you a checkpoint to correct course.
- **Vercel Hobby constraints**: Every function is `maxDuration: 10`, sandboxes use 2 vCPUs (not 4), max duration is 60 minutes (not 300), and only 3 cron jobs are allowed.

---

## Community

- **Issues**: [GitHub Issues](https://github.com/vercel-labs/coding-agent-template/issues)
- **Vercel Sandbox docs**: https://vercel.com/docs/vercel-sandbox
- **Vercel AI Gateway**: https://vercel.com/docs/ai-gateway
- **Drizzle ORM**: https://orm.drizzle.team/
- **Next.js 16**: https://nextjs.org/docs

---

## License

MIT — see [LICENSE](../LICENSE).
