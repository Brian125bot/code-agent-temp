import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, metricsDaily } from '@/lib/db/schema'
import { gte, lt, and, isNull, eq } from 'drizzle-orm'

export const maxDuration = 10

function isCronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const auth = req.headers.get('authorization') || ''
  const token = process.env.CRON_SECRET || process.env.SANDBOX_VERCEL_TOKEN
  if (token && auth === `Bearer ${token}`) return true
  if (process.env.NODE_ENV !== 'production') return true
  return false
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const yesterday = new Date(Date.now() - 86400000)
  yesterday.setUTCHours(0, 0, 0, 0)
  const nextDay = new Date(yesterday)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  const dateStr = yesterday.toISOString().slice(0, 10)

  const created = await db
    .select()
    .from(tasks)
    .where(and(gte(tasks.createdAt, yesterday), lt(tasks.createdAt, nextDay), isNull(tasks.deletedAt)))

  const completed = created.filter((t) => t.status === 'completed').length
  const failed = created.filter((t) => t.status === 'error').length

  try {
    await db
      .insert(metricsDaily)
      .values({
        date: dateStr,
        tasksCreated: created.length,
        tasksCompleted: completed,
        tasksFailed: failed,
        totalCostCents: 0,
      })
      .onConflictDoUpdate({
        target: metricsDaily.date,
        set: {
          tasksCreated: created.length,
          tasksCompleted: completed,
          tasksFailed: failed,
        },
      })
  } catch {
    try {
      const existing = await db.select().from(metricsDaily).where(eq(metricsDaily.date, dateStr)).limit(1)
      if (existing[0]) {
        await db
          .update(metricsDaily)
          .set({ tasksCreated: created.length, tasksCompleted: completed, tasksFailed: failed })
          .where(eq(metricsDaily.date, dateStr))
      } else {
        await db.insert(metricsDaily).values({
          date: dateStr,
          tasksCreated: created.length,
          tasksCompleted: completed,
          tasksFailed: failed,
          totalCostCents: 0,
        })
      }
    } catch (error) {
      console.error('Error writing metrics:', error)
    }
  }

  return NextResponse.json({
    date: dateStr,
    tasksCreated: created.length,
    tasksCompleted: completed,
    tasksFailed: failed,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
