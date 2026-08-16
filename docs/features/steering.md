# Task Steering

Allows a user to guide a running agent mid-execution by injecting contextual messages directly into the agent's next tool-call cycle. Available only for the `gateway` agent.

## How It Works

```
User types message in SteerInput
        ↓
POST /api/tasks/[taskId]/steer  { message: "Use a different approach..." }
        ↓
steering_messages table  (pending, appliedAt = null)
        ↓
Gateway agent polls for pending steering every tool call
        ↓
Steering message injected into next prompt context:
  [User steering]: <message>
        ↓
steering_messages.appliedAt = now()
        ↓
User sees confirmation in chat log
```

### Key design decisions

1. **Polling, not streaming**: The Gateway agent (`lib/sandbox/agents/gateway.ts`) checks the `steering_messages` table for unapplied messages after every tool execution (`readFile`, `writeFile`, `runCommand`, `listFiles`). This avoids the need for WebSocket connections into the sandbox VM.

2. **Fire-and-forget**: Steering messages are stored in the database and applied asynchronously. Even if the agent is between tool calls when you send a message, it will be picked up on the next tool result.

3. **Throttle**: A 5-second cooldown prevents message flooding (checked at both the API layer and via the `SteerThrottledError` class).

## API Reference

### `POST /api/tasks/[taskId]/steer`

Injects a steering message for a running task.

**Request body:**

```json
{
  "message": "Consider using a Map instead of multiple if statements here. Also check the README for conventions."
}
```

**Constraints:**

- `message` is required, must be a non-empty string
- Max length: 2000 characters
- Task must be in `processing` status (can only steer a running task)
- 5-second cooldown between steering messages per task (returns `429` if throttled)

**Response:**

| Status | Response                                                                   | Meaning                                              |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `201`  | `{ steer: { id, taskId, seq, body, createdAt } }`                          | Steering message queued                              |
| `400`  | `{ error: "Can only steer a processing task", code: "STEER_WRONG_STATE" }` | Task not in `processing`                             |
| `400`  | `{ error: "Message is required", code: "INVALID_BODY" }`                   | Missing or empty message                             |
| `400`  | `{ error: "Message too long", code: "INVALID_BODY" }`                      | Exceeds 2000 chars                                   |
| `429`  | `{ error: "Too many steering messages", code: "STEER_THROTTLED" }`         | Within 5s cooldown; includes `Retry-After: 5` header |
| `404`  | `{ error: "Task not found", code: "NOT_FOUND" }`                           | Task doesn't exist or belongs to another user        |
| `401`  | `{ error: "Unauthorized", code: "UNAUTHORIZED" }`                          | No valid session                                     |

## UI Component

The `SteerInput` component (`components/steer-input.tsx`) renders a text box at the bottom of the task view:

- **Only visible** when `taskStatus === 'processing'` — does not render for completed/error/awaiting_approval
- **Enter to send**: Press Enter (without Shift) to send; Shift+Enter inserts a newline
- **Cooldown timer**: After sending, the button shows `Wait 5s` and is disabled for 5 seconds
- **Toasts**: Shows success toast on 201, error toast on failure (including "Too many steering messages — wait 5s" on 429)

## Steering Messages Table

| Column       | Type        | Description                                |
| ------------ | ----------- | ------------------------------------------ |
| `id`         | `text` PK   | 12-char nanoid                             |
| `task_id`    | `text` FK   | References `tasks.id` (cascade delete)     |
| `seq`        | `integer`   | Monotonically increasing per task          |
| `body`       | `text`      | The steering message content               |
| `applied_at` | `timestamp` | When the agent applied it (null = pending) |
| `created_at` | `timestamp` | When the message was created               |

**Indexes:** `steering_task_idx` (on `task_id`), `steering_task_seq_idx` (unique on `task_id, seq`)

## Error Handling

The `SteerThrottledError` class (`lib/utils/errors.ts`) extends `AppError` with:

- `code: 'STEER_THROTTLED'`
- `status: 429`

This follows the project-wide `AppError` pattern — all API routes catch `AppError` instances and return structured `{ error, code, status }` responses.
