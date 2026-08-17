import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { AppError } from '@/lib/utils/errors'
import { getAppUrl } from '@/lib/utils/app-url'

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
    if (task.status !== 'awaiting_approval') {
      return NextResponse.json({ error: 'Task is not awaiting approval', code: 'INVALID_STATE' }, { status: 400 })
    }

    await db
      .update(tasks)
      .set({ status: 'processing', updatedAt: new Date() } as never)
      .where(eq(tasks.id, taskId))

    const runUrl = `${getAppUrl()}/api/internal/run-phase`
    fetch(runUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: req.headers.get('cookie') || '',
      },
      body: JSON.stringify({ taskId, phase: 'execution' }),
    }).catch((err) => console.error('Failed to trigger execution phase:', err))

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error approving task:', error)
    return NextResponse.json({ error: 'Failed to approve task', code: 'INTERNAL' }, { status: 500 })
  }
}
