import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, audioSummaries } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { AppError } from '@/lib/utils/errors'

export const maxDuration = 10

export async function GET(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
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
    const rows = await db
      .select()
      .from(audioSummaries)
      .where(eq(audioSummaries.taskId, taskId))
      .orderBy(desc(audioSummaries.createdAt))
    return NextResponse.json({ audio: rows[0] || null, all: rows })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error fetching audio:', error)
    return NextResponse.json({ error: 'Failed to fetch audio', code: 'INTERNAL' }, { status: 500 })
  }
}

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
    if (task.status !== 'completed') {
      return NextResponse.json({ error: 'Task not completed', code: 'AUDIO_NOT_READY' }, { status: 400 })
    }

    const existing = await db
      .select()
      .from(audioSummaries)
      .where(eq(audioSummaries.taskId, taskId))
      .orderBy(desc(audioSummaries.createdAt))
      .limit(1)
    if (existing[0]) {
      return NextResponse.json({ audio: existing[0], cached: true })
    }

    const { after } = await import('next/server')
    after(async () => {
      try {
        const { generateAudioSummary } = await import('@/lib/audio/generate-summary')
        await generateAudioSummary(taskId)
      } catch (error) {
        console.error('Error generating audio:', error)
      }
    })

    return NextResponse.json({ queued: true }, { status: 202 })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error queuing audio:', error)
    return NextResponse.json({ error: 'Failed to queue audio', code: 'INTERNAL' }, { status: 500 })
  }
}
