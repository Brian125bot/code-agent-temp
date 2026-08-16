import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, logEntrySchema } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTaskLogger } from '@/lib/utils/task-logger'

const bodySchema = z.object({
  logs: z.array(logEntrySchema),
  progress: z.number().min(0).max(100).optional(),
  status: z.enum(['pending', 'processing', 'completed', 'error']).optional(),
})

function isAuthorized(req: NextRequest): boolean {
  const cronHeader = req.headers.get('x-vercel-cron')
  if (cronHeader) return true
  const auth = req.headers.get('authorization') || ''
  const token = process.env.SANDBOX_VERCEL_TOKEN
  if (token && auth === `Bearer ${token}`) return true
  const ingestToken = process.env.INGEST_TOKEN
  if (ingestToken && auth === `Bearer ${ingestToken}`) return true
  return false
}

export async function POST(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { taskId } = await context.params
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const body = await req.json()
    const parsed = bodySchema.parse(body)
    const logger = createTaskLogger(taskId)

    for (const entry of parsed.logs) {
      await logger.append(entry.type, entry.message)
    }
    if (typeof parsed.progress === 'number') {
      await db.update(tasks).set({ progress: parsed.progress, updatedAt: new Date() }).where(eq(tasks.id, taskId))
    }
    if (parsed.status) {
      await logger.updateStatus(parsed.status)
    }
    await db.update(tasks).set({ ingestCursor: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId))

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Ingest logs error:', error)
    return NextResponse.json({ error: 'Failed to ingest logs' }, { status: 500 })
  }
}
