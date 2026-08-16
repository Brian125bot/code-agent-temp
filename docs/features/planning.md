# Plan Approval Workflow

When using the `gateway` agent (the default), task execution is split into two phases: **planning** and **execution**. The planner generates a structured plan first; the user reviews, edits, and approves it before execution begins. This gives users a checkpoint to correct course before the agent makes changes.

## Two-Phase Execution Flow

```
POST /api/tasks
  { prompt, repoUrl, selectedAgent: "gateway" }
        │
        ▼
after() → runPlannerPhase()
        │
        ▼
1. PLANNER PHASE
   ├─ createSandbox (5-min timeout, vcpus: 2)
   ├─ runPlannerInSandbox()
   │    ├─ Gemini Pro (google/gemini-2.5-pro via Gateway)
   │    ├─ Read-only tools: readFile, listFiles, runCommand
   │    ├─ Explores repo structure and patterns
   │    └─ Generates structured plan (Zod-validated)
   ├─ Store plan in plans table (versioned)
   ├─ Set task.status = "awaiting_approval"
   └─ Shutdown sandbox
        │
        ▼
2. APPROVAL PHASE (UI)
   ├─ PlanEditor renders the plan
   ├─ User can Edit → modify JSON (Zod-validated)
   │   or Approve → POST /api/tasks/[taskId]/approve
   └─ User can Steer during processing (after approval)
        │
        ▼
3. EXECUTION PHASE
   POST /api/tasks/[taskId]/approve → runExecutionPhase()
   ├─ createSandbox (maxDuration-min timeout, vcpus: 2)
   ├─ Append plan to prompt: "Approved plan: {plan JSON}"
   ├─ executeGatewayInSandbox()
   │    ├─ GPT-5-nano via Gateway
   │    ├─ Read-write tools: readFile, writeFile, runCommand, listFiles
   │    ├─ Polls steering_messages between tool calls
   │    └─ Makes code changes
   ├─ pushChangesToBranch() → git push
   ├─ Create PR via Octokit
   ├─ Optionally generate audio summary
   └─ Set task.status = "completed" or "error"
```

## Planner Agent

The planner (`lib/sandbox/planner.ts`) uses `google/gemini-2.5-pro` routed through Vercel AI Gateway. It runs inside the sandbox with a system prompt loaded from `lib/sandbox/prompts/planner-system-prompt.md`.

### Planner constraints

- **Read-only**: The planner only uses `readFile`, `listFiles`, and `runCommand` tools. It **cannot** write files — the system prompt explicitly instructs: _"You MUST NOT write, edit, or delete files."_
- **Minimal**: "Keep the plan minimal — the smallest correct change that satisfies the instruction"
- **Honest about risk**: Risk levels are not artificially minimized. Changes touching auth, payments, migrations, or irreversible operations are marked `high`.
- **CI auto-fix**: If the prompt starts with "CI failed", the planner is limited to at most 3 steps and 2 files — minimum change to make CI green, no scope creep.

### Planner sandbox

- Timeout: 5 minutes (down from the standard 60-minute sandbox)
- vCPUs: 2
- Resources are freed immediately after planning — the sandbox is shut down before approval

## Plan Schema

Defined in `lib/plans/schema.ts` using Zod:

```typescript
const planStepSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['edit', 'create', 'delete', 'run_cmd', 'run_tests']),
  files: z.array(z.string()).optional(),
  rationale: z.string().min(1),
  risk: z.enum(['low', 'medium', 'high']),
})

const planSchema = z.object({
  goal: z.string().min(1),
  assumptions: z.array(z.string()),
  steps: z.array(planStepSchema).min(1),
  estimated_files_changed: z.number().int().min(0),
  estimated_loc: z.number().int().min(0),
  test_command: z.string().optional(),
})
```

### Field meanings

| Field                     | Description                                                                    |
| ------------------------- | ------------------------------------------------------------------------------ |
| `goal`                    | High-level description of what the plan accomplishes                           |
| `assumptions`             | List of assumptions the plan relies on (explicit, not hidden)                  |
| `steps[]`                 | Ordered list of actions to execute                                             |
| `steps[].id`              | Unique identifier within the plan (e.g. `"1"`, `"2"`)                          |
| `steps[].action`          | `edit`, `create`, `delete`, `run_cmd`, or `run_tests`                          |
| `steps[].files`           | Files affected by this step (may be empty for `run_cmd`/`run_tests`)           |
| `steps[].rationale`       | Why this step is needed                                                        |
| `steps[].risk`            | `low` (green), `medium` (yellow), or `high` (red) — subjective risk assessment |
| `estimated_files_changed` | Rough count of files expected to change                                        |
| `estimated_loc`           | Rough estimate of lines of code to add/remove                                  |
| `test_command`            | Command to verify the changes (e.g. `"pnpm test"`)                             |

## API Endpoints

### `GET /api/tasks/[taskId]/plan`

Returns all plans for a task, newest version first.

**Response:** `{ plans: Plan[] }`

### `POST /api/tasks/[taskId]/plan`

Creates a new plan version for a task. Used by the `PlanEditor` when editing a plan.

**Request body:**

```json
{
  "goal": "Add a dark mode toggle to the settings page",
  "assumptions": ["tailwind.config.ts already has dark mode configured", "no existing theme context"],
  "steps": [
    {
      "id": "1",
      "action": "edit",
      "files": ["components/settings-page.tsx"],
      "rationale": "Add toggle switch bound to theme context",
      "risk": "low"
    },
    {
      "id": "2",
      "action": "run_cmd",
      "files": [],
      "rationale": "Verify build passes with new component",
      "risk": "low"
    }
  ],
  "estimated_files_changed": 2,
  "estimated_loc": 15,
  "test_command": "pnpm build"
}
```

**Response (201):**

```json
{
  "plan": {
    "id": "ABC123xyz789",
    "taskId": "...",
    "version": 2,
    "content": {
      /* plan object */
    },
    "authoredBy": "user",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

**Response (400):** `{ error: "...", code: "PLAN_SCHEMA_ERROR" }` — returned when the plan body fails Zod validation, with specific field-level errors

### `POST /api/tasks/[taskId]/approve`

Triggers the execution phase for a task in `awaiting_approval` status.

- Sets `task.status = 'processing'`
- Triggers `runExecutionPhase(taskId)` via `after()` (fire-and-forget)
- Returns `{ ok: true }` immediately — execution continues inside the sandbox VM

**Response (400):** `{ error: "Task is not awaiting approval", code: "INVALID_STATE" }` — if task is not in `awaiting_approval` status

## UI Components

### PlanEditor (`components/plan-editor.tsx`)

Renders the plan in one of two modes:

**Read mode** (default):

- Plan version badge and author (`agent` or `user`)
- Goal section
- Assumptions list (if non-empty)
- Steps list — each step shows:
  - Step ID and action badge (e.g. `EDIT`, `CREATE`, `RUN_CMD`)
  - Risk badge with color coding (green/yellow/red)
  - Files affected (if any)
  - Rationale text
- Summary row: estimated files, LOC, test command

**Edit mode** (activated by Edit button):

- JSON textarea with syntax highlighting
- Real-time Zod validation — shows field-level errors
- Save button creates a new plan version (incremented)
- Cancel button reverts to read mode

**Approval button** (only visible when `taskStatus === 'awaiting_approval'`):

- Green "Approve & Run" button
- Calls `POST /api/tasks/[taskId]/approve`
- Shows spinner during approval
- Triggers `onApproved()` callback to refresh the task

### SteerInput (`components/steer-input.tsx`)

While the plan editor is visible during `awaiting_approval`, the `SteerInput` is **not** shown. It only appears during `processing` (after approval). See [Task Steering](./steering.md) for details.

## Retry Behavior

The retry flow branches based on the task's `selectedAgent`:

| Agent                                                        | Retry behavior                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `gateway`                                                    | Calls `runPlannerPhase()` — generates a fresh plan from scratch (the old plan is still in the DB for reference) |
| `claude`, `codex`, `copilot`, `cursor`, `gemini`, `opencode` | Calls `runTaskAsync()` — runs the agent directly without a planning phase                                       |

This means retrying a `gateway`-agent task re-enters the full plan-approval flow, while retrying a legacy agent task goes straight to execution.
