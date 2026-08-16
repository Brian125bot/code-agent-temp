import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, steeringMessages, taskMessages } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { generateId } from '@/lib/utils/id'
import { SteerThrottledError, AppError } from '@/lib/utils/errors'

export const maxDuration = 10

export async function POST(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    const { taskId } = await context.params
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)
    if (!task) {
      return NextResponse.json({ error: 'Task not found', code: 'NOT_FOUND' }, { status: 404 })
    }
    if (task.status !== 'processing') {
      return NextResponse.json(
        { error: 'Can only steer a processing task', code: 'STEER_WRONG_STATE' },
        { status: 400 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, { status: 400 })
    }

    const message = (body as { message?: unknown }).message
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Message is required', code: 'INVALID_BODY' }, { status: 400 })
    }
    if (message.trim().length > 2000) {
      return NextResponse.json({ error: 'Message too long', code: 'INVALID_BODY' }, { status: 400 })
    }

    const recent = await db
      .select()
      .from(steeringMessages)
      .where(eq(steeringMessages.taskId, taskId))
      .orderBy(desc(steeringMessages.createdAt))
      .limit(1)
    if (recent[0]) {
      const elapsed = Date.now() - new Date(recent[0].createdAt).getTime()
      if (elapsed < 5000) {
        return NextResponse.json(
          { error: 'Too many steering messages', code: 'STEER_THROTTLED' },
          { status: 429, headers: { 'Retry-After': '5' } },
        )
      }
    }

    const maxSeq = await db
      .select()
      .from(steeringMessages)
      .where(eq(steeringMessages.taskId, taskId))
      .orderBy(desc(steeringMessages.seq))
      .limit(1)
    const nextSeq = maxSeq[0] ? maxSeq[0].seq + 1 : 1

    const trimmed = message.trim()
    const [steer] = await db
      .insert(steeringMessages)
      .values({
        id: generateId(12),
        taskId,
        seq: nextSeq,
        body: trimmed,
      })
      .returning()

    try {
      await db.insert(taskMessages).values({
        id: generateId(12),
        taskId,
        role: 'user',
        content: trimmed,
      })
    } catch {}

    return NextResponse.json({ steer }, { status: 201 })
  } catch (error) {
    if (error instanceof SteerThrottledError || error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error steering task:', error)
    return NextResponse.json({ error: 'Failed to steer task', code: 'INTERNAL' }, { status: 500 })
  }
}
