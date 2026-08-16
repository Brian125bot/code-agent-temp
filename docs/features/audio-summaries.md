# Audio Changelog

Generates an AI-narrated summary of what a completed task's changes do, stored as an MP3 (via ElevenLabs) or text file (fallback) in Vercel Blob storage. The audio summary is also posted as a comment on the PR.

## How It Works

```
Task completes → PR created
        │
        ▼
User clicks "Generate" OR cron picks it up
        │
        ▼
POST /api/tasks/[taskId]/audio  (202 Accepted)
        │
        ▼
after() → generateAudioSummary(taskId)
        │
        ├─ 1. Fetch diff
        │    ├─ compareCommits(base: main, head: branch) via Octokit
        │    └─ Fallback: PR body if diff fetch fails
        │
        ├─ 2. Generate transcript
        │    ├─ generateText(prompt: "Explain what this PR does in
        │    │                     plain language, 60-90 seconds spoken")
        │    │     model: openai/gpt-5-nano (via Gateway)
        │    └─ Fallback: "Changes completed." on error
        │
        ├─ 3. Optional: Convert to speech
        │    ├─ ELEVENLABS_API_KEY set → MP3 via ElevenLabs
        │    └─ Not set → text file fallback via Vercel Blob
        │
        ├─ 4. Store in Vercel Blob
        │    └─ Key: audio/{taskId}-{diffHash}.mp3 (or .txt)
        │
        ├─ 5. Save to audio_summaries table
        │    └─ Includes: blobUrl, transcript, durationSec, modelVersion, diffHash
        │
        └─ 6. Post PR comment (if PR exists)
             └─ "🎧 [Listen](url) (Xs) — AI-generated changelog"
```

## When Audio is Generated

### Manual trigger (user-initiated)

- **Button**: "Generate" button in the `AudioPlayer` component, shown on completed tasks
- **API**: `POST /api/tasks/[taskId]/audio`
- Returns `202 Accepted` with `{ queued: true }` if generation is started
- Returns `200 OK` with `{ audio: {...}, cached: true }` if audio already exists for the current diff

### Automatic trigger (cron)

- **Schedule**: Every 10 minutes (`*/10 * * * *`)
- **Cron route**: `GET /api/cron/audio`
- Finds one completed task without an audio summary (limit 1 per run)
- Calls `generateAudioSummary(taskId)` directly
- This ensures audio is eventually generated for all completed PRs, even if the user doesn't click "Generate"

### After task completion

The orchestrator's `runExecutionPhase` checks for existing audio summaries after pushing changes and attempts to append the audio link to the PR body. If audio hasn't been generated yet, the PR body just contains the prompt.

## Caching

Audio summaries are cached by a combination of:

- `task_id` — scoped to the task
- `diff_hash` — SHA-256 hash of the PR diff (so identical diffs don't regenerate)
- `model_version` — `"openai/gpt-5-nano:tts"` (tracks which model generated it)

If a cached entry exists, it's returned immediately with `cached: true` instead of regenerating.

## API Endpoints

### `GET /api/tasks/[taskId]/audio`

Returns the latest audio summary for a task.

**Response (200):**

```json
{
  "audio": {
    "id": "ABC123",
    "taskId": "...",
    "blobUrl": "https://....vercel-storage.com/audio/...",
    "transcript": "This PR adds a dark mode toggle...",
    "durationSec": 75,
    "modelVersion": "openai/gpt-5-nano:tts",
    "diffHash": "a1b2c3d4...",
    "createdAt": "2025-01-01T00:00:00.000Z"
  },
  "all": [
    /* older audio summaries */
  ]
}
```

**Response (200):** `{ audio: null, all: [] }` — if no audio exists yet

### `POST /api/tasks/[taskId]/audio`

Queues audio summary generation for a completed task.

**Response (202):** `{ queued: true }` — generation started in background via `after()`

**Response (200):** `{ audio: {...}, cached: true }` — audio already exists

**Response (400):** `{ error: "Task not completed", code: "AUDIO_NOT_READY" }` — task hasn't reached `completed` status

## UI Component

The `AudioPlayer` component (`components/audio-player.tsx`) renders:

1. **Before audio exists** (on completed tasks):
   - "No audio changelog yet" message
   - "Generate" button (shows spinner while generating)

2. **After audio exists**:
   - MP3 player with controls (if ElevenLabs was used)
   - Or a "View transcript file" link (if text-only fallback)
   - Collapsible transcript section
   - Duration display in the header (e.g. "(75s)")

3. **Auto-fetch**: On mount, automatically fetches audio. Polls every 30 seconds for new audio while none exists.

## Audio Summaries Table

| Column          | Type        | Description                                              |
| --------------- | ----------- | -------------------------------------------------------- |
| `id`            | `text` PK   | 12-char nanoid                                           |
| `task_id`       | `text` FK   | References `tasks.id` (cascade delete)                   |
| `blob_url`      | `text`      | URL to the Vercel Blob (MP3 or TXT)                      |
| `transcript`    | `text`      | Full transcript text                                     |
| `duration_sec`  | `integer`   | Estimated speaking time in seconds                       |
| `model_version` | `text`      | Model used for generation (e.g. `openai/gpt-5-nano:tts`) |
| `diff_hash`     | `text`      | SHA-256 hash of the PR diff (for caching)                |
| `created_at`    | `timestamp` | When the audio summary was created                       |

**Indexes:** `audio_task_idx` (on `task_id`), `audio_task_diff_model_idx` (unique on `task_id, diff_hash, model_version`)

## Optional Configuration

| Variable              | Default                | Description                                                                    |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `ELEVENLABS_API_KEY`  | —                      | ElevenLabs API key for MP3 generation. If unset, audio is stored as text files |
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` | Custom voice ID for ElevenLabs TTS                                             |
