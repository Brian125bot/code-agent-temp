# Agent Configuration

The agent system supports multiple coding agent backends, all routed through **Vercel AI Gateway** as the sole inference provider. The default `gateway` agent is a native implementation using the `ai` SDK (no CLI install needed). Legacy agents (Claude, Codex, etc.) require CLI tools installed inside the sandbox VM.

## Agent Types

| Agent      | Default | Planning phase           | Execution          | CLI installed?   | Gateway routing                            |
| ---------- | ------- | ------------------------ | ------------------ | ---------------- | ------------------------------------------ |
| `gateway`  | Yes     | Yes (Gemini Pro planner) | Native `ai` SDK    | No               | `AI_GATEWAY_API_KEY` direct                |
| `claude`   | No      | No (legacy flow)         | Claude Code CLI    | Yes (in sandbox) | `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` |
| `codex`    | No      | No (legacy flow)         | Codex CLI          | Yes (in sandbox) | `model_provider = "vercel-ai-gateway"`     |
| `copilot`  | No      | No (legacy flow)         | GitHub Copilot CLI | Yes (in sandbox) | GitHub token (no Gateway)                  |
| `cursor`   | No      | No (legacy flow)         | Cursor CLI         | Yes (in sandbox) | `CURSOR_API_KEY`                           |
| `gemini`   | No      | No (legacy flow)         | Gemini CLI         | Yes (in sandbox) | `GEMINI_API_KEY`                           |
| `opencode` | No      | No (legacy flow)         | OpenCode CLI       | Yes (in sandbox) | `OPENAI_API_KEY` or Gateway                |

## Gateway Agent (Default)

The **Gateway agent** is the recommended default and the only agent with the two-phase plan-approval workflow.

### How it works

1. **Planning phase**: Uses `google/gemini-2.5-pro` (via AI Gateway) to explore the repository with read-only tools (`readFile`, `listFiles`, `runCommand`). Generates a structured plan stored in the `plans` table. Task enters `awaiting_approval` status.

2. **Execution phase**: After user approval, uses `openai/gpt-5-nano` (via AI Gateway) with read-write tools (`readFile`, `writeFile`, `runCommand`, `listFiles`) to make actual code changes.

### Required

- `AI_GATEWAY_API_KEY` — set globally or per-user in Profile → API Keys dialog

### Gateway agent tools

All four tools execute commands **inside** the sandbox VM via `sandbox.runCommand` or `runInProject`:

| Tool         | Description                                  | Read-only?          |
| ------------ | -------------------------------------------- | ------------------- |
| `readFile`   | Read a file from the sandbox project         | Yes (planning only) |
| `writeFile`  | Write content to a file                      | No (execution only) |
| `runCommand` | Run a shell command in the project directory | No (execution only) |
| `listFiles`  | List files matching a pattern                | Yes                 |

### Steering integration

The Gateway agent polls the `steering_messages` table after every tool execution. If pending steering messages exist, they are appended to the context:

```
[User steering]: <message>
```

See [Task Steering](./features/steering.md) for details.

### Model routing

The Gateway agent uses the `ai` SDK's model string to route through AI Gateway:

- Planning: `google/gemini-2.5-pro` (hardcoded in `lib/sandbox/planner.ts`)
- Execution: `openai/gpt-5-nano` (or `selectedModel`/`gatewayModel` if provided)

Available Gateway models (from `lib/constants.ts`):

| Model string                  | Human-readable       |
| ----------------------------- | -------------------- |
| `openai/gpt-5`                | GPT-5                |
| `openai/gpt-5-mini`           | GPT-5 Mini           |
| `openai/gpt-5-nano`           | GPT-5 Nano (default) |
| `anthropic/claude-sonnet-4-5` | Claude Sonnet 4.5    |
| `anthropic/claude-haiku-4-5`  | Claude Haiku 4.5     |
| `google/gemini-2.5-pro`       | Gemini 2.5 Pro       |

## Claude Agent

Runs the **Claude Code CLI** inside the sandbox VM.

### Configuration

In `lib/sandbox/agents/claude.ts`, the Claude CLI is configured with:

```bash
ANTHROPIC_API_KEY=$AI_GATEWAY_API_KEY
ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh
```

This routes all Claude CLI requests through Vercel AI Gateway — no separate Anthropic key is needed.

### Models

| Value                       | Label                       |
| --------------------------- | --------------------------- |
| `claude-sonnet-4-5`         | Claude Sonnet 4.5 (default) |
| `anthropic/claude-opus-4.6` | Claude Opus 4.6             |
| `claude-haiku-4-5`          | Claude Haiku 4.5            |

### Required

- `AI_GATEWAY_API_KEY` (routed as `ANTHROPIC_API_KEY`)

## Codex Agent

Runs the **OpenAI Codex CLI** inside the sandbox VM.

### Configuration

Writes `~/.codex/config.toml` inside the sandbox with:

```toml
model_provider = "vercel-ai-gateway"
base_url = "https://ai-gateway.vercel.sh/v1"
```

### Models

| Value                       | Label              |
| --------------------------- | ------------------ |
| `openai/gpt-5.1`            | GPT-5.1 (default)  |
| `openai/gpt-5.1-codex`      | GPT-5.1-Codex      |
| `openai/gpt-5.1-codex-mini` | GPT-5.1-Codex mini |
| `openai/gpt-5`              | GPT-5              |
| `openai/gpt-5-mini`         | GPT-5 mini         |
| `openai/gpt-5-nano`         | GPT-5 nano         |
| `gpt-5-pro`                 | GPT-5 Pro          |
| `openai/gpt-4.1`            | GPT-4.1            |

### Required

- `AI_GATEWAY_API_KEY` (routed as `OPENAI_API_KEY`)

## Legacy Agents (gated)

The following agents require setting `ENABLE_LEGACY_AGENTS=1` in your environment. By default, they are blocked with a helpful error message.

| Agent      | CLI                | API key                               | Models                                                                                                     |
| ---------- | ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `copilot`  | GitHub Copilot CLI | GitHub token (`getUserGitHubToken()`) | `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`, `gpt-5`                                        |
| `cursor`   | Cursor CLI         | `CURSOR_API_KEY`                      | `auto`, `sonnet-4.5`, `sonnet-4.5-thinking`, `gpt-5`, `gpt-5-codex`, `opus-4.1`, `grok`                    |
| `gemini`   | Gemini CLI         | `GEMINI_API_KEY`                      | `gemini-3-pro-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`                                               |
| `opencode` | OpenCode CLI       | `OPENAI_API_KEY` or Gateway           | `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5` |

### Per-agent API key lookup

API keys are resolved per-user from the `keys` table (stored encrypted via `lib/crypto.ts`):

1. `getUserApiKeys()` (`lib/api-keys/user-keys.ts`) fetches the user's encrypted keys from the database
2. Keys are decrypted using `ENCRYPTION_KEY`
3. The agent index (`lib/sandbox/agents/index.ts`) temporarily sets the key as `process.env` before agent execution, then restores originals in a `finally` block

### Copilot special case

The Copilot agent uses the user's **GitHub token** (from their linked GitHub account) instead of an API key. This provides access to private repos that the GitHub token has access to.

## How Agent Selection Flows

```
User selects agent/model in TaskForm
        ↓
POST /api/tasks { selectedAgent, selectedModel, ... }
        ↓
insertTaskSchema validates (selectedAgent enum: gateway|claude|codex|copilot|cursor|gemini|opencode)
        ↓
Task row inserted (status: 'pending')
        ↓
if selectedAgent === 'gateway' && repoUrl is set:
    after() → runPlannerPhase() → runPlannerInSandbox() → status: 'awaiting_approval'
else:
    Client calls POST /api/tasks/[taskId]/start → runTaskAsync()
        ↓
runTaskAsync() or runPlannerPhase()
        ↓
if selectedAgent === 'gateway':
    runPlannerPhase() (if called from retry) or continue to execution
else:
    runTaskAsync() → executeAgentInSandbox()
        ↓
executeAgentInSandbox() dispatches to:
    gateway → executeGatewayInSandbox()
    claude  → executeClaudeInSandbox()
    codex   → executeCodexInSandbox()
    copilot/cursor/gemini/opencode → respective CLI executor (gated by ENABLE_LEGACY_AGENTS)
```

### Retry branching

When a task is retried (`POST /api/tasks/[taskId]/retry`):

- `gateway` agent → `runPlannerPhase()` (fresh plan, re-enters approval flow)
- Any other agent → `runTaskAsync()` (direct execution, no planning)
