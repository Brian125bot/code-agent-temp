import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, lt } from 'drizzle-orm'
import { createTaskLogger } from '@/lib/utils/task-logger'

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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000)
  const staleTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, 'processing'), lt(tasks.updatedAt, staleCutoff)))
    .limit(20)

  let checked = 0
  let recovered = 0

  for (const task of staleTasks) {
    checked++
    if (!task.sandboxId) continue

    try {
      const { Sandbox } = await import('@vercel/sandbox')
      const sandbox = await Sandbox.get({
        sandboxId: task.sandboxId,
        teamId: process.env.SANDBOX_VERCEL_TEAM_ID!,
        projectId: process.env.SANDBOX_VERCEL_PROJECT_ID!,
        token: process.env.SANDBOX_VERCEL_TOKEN!,
      } as never)

      const probe = await sandbox.runCommand('sh', [
        '-c',
        'ps aux | head -20; echo "---"; git -C /vercel/sandbox/project status --porcelain 2>&1 | head -20',
      ])
      const output = (await probe.stdout()) || ''
      const hasChanges = output.includes('M ') || output.includes('A ') || output.includes('??')

      if (!hasChanges && output.includes('ps aux')) {
        const logger = createTaskLogger(task.id)
        const isStillRunning =
          output.toLowerCase().includes('claude') ||
          output.toLowerCase().includes('codex') ||
          output.toLowerCase().includes('node')
        if (!isStillRunning) {
          await logger.info('Reaper detected stalled task, marking for retry')
        }
      }
      void recovered
    } catch {
      const logger = createTaskLogger(task.id)
      await logger.info('Reaper could not reach sandbox')
    }
  }

  return NextResponse.json({ checked, recovered, staleCutoff: staleCutoff.toISOString() })
}
