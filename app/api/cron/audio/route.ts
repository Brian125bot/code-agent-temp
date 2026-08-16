import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, audioSummaries } from '@/lib/db/schema'
import { eq, and, isNull, notExists } from 'drizzle-orm'

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

  const candidates = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'completed'),
        isNull(tasks.deletedAt),
        notExists(db.select().from(audioSummaries).where(eq(audioSummaries.taskId, tasks.id))),
      ),
    )
    .limit(1)

  if (candidates.length === 0) {
    return NextResponse.json({ processed: null })
  }

  const taskId = candidates[0].id
  try {
    const { generateAudioSummary } = await import('@/lib/audio/generate-summary')
    await generateAudioSummary(taskId)
    return NextResponse.json({ processed: taskId })
  } catch (error) {
    console.error('Error in audio cron:', error)
    return NextResponse.json({ processed: null, error: 'Failed to generate audio' })
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
