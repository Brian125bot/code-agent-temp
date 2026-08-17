import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, isNull, lt, count } from 'drizzle-orm'

const STALE_MS = 5 * 60 * 1000

const STUCK_ERROR_MESSAGE = 'Task timed out during startup and was automatically marked as failed. Please retry.'

function staleCutoff(): Date {
  return new Date(Date.now() - STALE_MS)
}

function stuckWhere() {
  return and(
    eq(tasks.status, 'processing'),
    isNull(tasks.sandboxId),
    lt(tasks.updatedAt, staleCutoff()),
    isNull(tasks.deletedAt),
  )
}

/**
 * Mark a specific task as failed if it is stuck in the processing state
 * without a sandbox for more than 5 minutes.
 */
export async function healStuckTaskById(taskId: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: 'error',
      error: STUCK_ERROR_MESSAGE,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.status, 'processing'),
        isNull(tasks.sandboxId),
        lt(tasks.updatedAt, staleCutoff()),
        isNull(tasks.deletedAt),
      ),
    )
}

/**
 * Mark all of a user's tasks as failed if they are stuck in the processing
 * state without a sandbox for more than 5 minutes.
 */
export async function healStuckTasksByUser(userId: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: 'error',
      error: STUCK_ERROR_MESSAGE,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.status, 'processing'),
        isNull(tasks.sandboxId),
        lt(tasks.updatedAt, staleCutoff()),
        isNull(tasks.deletedAt),
      ),
    )
}

/**
 * Mark any task as failed if it is stuck in the processing state without a
 * sandbox for more than 5 minutes. Intended for cron/background use.
 */
export async function healAllStuckTasks(): Promise<number> {
  const [{ value }] = await db.select({ value: count() }).from(tasks).where(stuckWhere())
  await db
    .update(tasks)
    .set({
      status: 'error',
      error: STUCK_ERROR_MESSAGE,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(stuckWhere())
  return value
}
