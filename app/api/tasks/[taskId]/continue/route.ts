import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/session/get-server-session'
import { db } from '@/lib/db/client'
import { tasks, taskMessages } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { getAppUrl } from '@/lib/utils/app-url'

export async function POST(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit for follow-up messages
    const rateLimit = await checkRateLimit(session.user.id)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `You have reached the daily limit of ${rateLimit.total} messages (tasks + follow-ups). Your limit will reset at ${rateLimit.resetAt.toISOString()}`,
          remaining: rateLimit.remaining,
          total: rateLimit.total,
          resetAt: rateLimit.resetAt.toISOString(),
        },
        { status: 429 },
      )
    }

    const { taskId } = await context.params
    const body = await req.json()
    const { message } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Get the task and verify ownership
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Check if task has a branch name (required to continue)
    if (!task.branchName) {
      return NextResponse.json({ error: 'Task does not have a branch to continue from' }, { status: 400 })
    }

    // Save the user's message
    await db.insert(taskMessages).values({
      id: generateId(12),
      taskId,
      role: 'user',
      content: message.trim(),
    })

    // Reset task status and progress
    await db
      .update(tasks)
      .set({
        status: 'processing',
        progress: 0,
        updatedAt: new Date(),
        completedAt: null,
      })
      .where(eq(tasks.id, taskId))

    // Trigger continuation via Hobby-safe internal route
    const runUrl = `${getAppUrl()}/api/internal/run-phase`
    fetch(runUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: req.headers.get('cookie') || '',
      },
      body: JSON.stringify({ taskId, phase: 'continue' }),
    }).catch((err) => console.error('Failed to trigger continue phase:', err))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error continuing task:', error)
    return NextResponse.json({ error: 'Failed to continue task' }, { status: 500 })
  }
}
