# Metrics Dashboard

Daily task metrics aggregated automatically via cron and displayed on an admin-only page.

## Metrics Table

The `metrics_daily` table (`lib/db/schema.ts`) stores one row per day:

| Column             | Type      | Description                                                           |
| ------------------ | --------- | --------------------------------------------------------------------- |
| `date`             | `date` PK | UTC date (e.g. `2025-01-15`)                                          |
| `workspace_id`     | `text`    | Currently unused (always null) — reserved for multi-workspace support |
| `tasks_created`    | `integer` | Count of tasks created that day                                       |
| `tasks_completed`  | `integer` | Count of tasks that reached `completed` status                        |
| `tasks_failed`     | `integer` | Count of tasks that reached `error` status                            |
| `total_cost_cents` | `integer` | Currently always 0 — reserved for future cost tracking                |

## Daily Aggregation Cron

**Schedule**: `5 0 * * *` (daily at 00:05 UTC)

**Route**: `GET /api/cron/metrics`

**Authorization**: `x-vercel-cron` header (Vercel), or `Bearer CRON_SECRET`, or `Bearer SANDBOX_VERCEL_TOKEN`. In non-production, accessible without auth.

**What it does:**

1. Calculates yesterday's UTC date range
2. Queries all non-deleted tasks created in that range
3. Counts how many reached `completed` vs `error` status
4. Inserts or updates `metrics_daily` row for that date (upsert)
5. Returns the aggregated numbers as JSON

**Response:**

```json
{
  "date": "2025-01-15",
  "tasksCreated": 42,
  "tasksCompleted": 38,
  "tasksFailed": 4
}
```

## Admin Dashboard

**Route**: `app/admin/metrics/page.tsx`

**Enable**: Set `NEXT_PUBLIC_ADMIN_ENABLED=true` in your environment variables. If this is not set, the page returns a 404 (not found) — there is no additional authentication layer beyond the Next.js session.

### What the dashboard shows

1. **7-day summary table**: Date, tasks created, tasks completed, tasks failed, and success rate (completed / (completed + failed))
2. **7-day volume bar chart**: Horizontal bars showing daily task creation volume, scaled to the max across the 7 days
3. **30-day expanded view**: A collapsible `<details>` element showing all 30 days in a table format

### Success rate calculation

```
success_rate = tasks_completed / (tasks_completed + tasks_failed) * 100
```

If no tasks completed or failed on a given day, the rate displays as `—`.

## Cron Jobs Overview

This project uses all 3 Vercel Hobby cron slots:

| Cron    | Schedule       | Route               | Purpose                                       |
| ------- | -------------- | ------------------- | --------------------------------------------- |
| Reaper  | `*/5 * * * *`  | `/api/cron/reap`    | Recover stale `processing` tasks              |
| Audio   | `*/10 * * * *` | `/api/cron/audio`   | Generate audio changelogs for completed tasks |
| Metrics | `5 0 * * *`    | `/api/cron/metrics` | Aggregate daily task counts                   |

> **Vercel Hobby limit**: Maximum 3 crons per project. This project uses all 3. Adding more will prevent deployment.
