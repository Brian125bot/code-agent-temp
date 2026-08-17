import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, taskMessages } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { getUserApiKeys } from '@/lib/api-keys/user-keys'
import { getUserGitHubToken } from '@/lib/github/user-token'
import { getGitHubUser } from '@/lib/github/client'
import { getMaxSandboxDuration } from '@/lib/db/settings'

export const maxDuration = 10

const VALID_PHASES = ['planner', 'execution', 'continue', 'audio'] as const
type Phase = (typeof VALID_PHASES)[number]

function isValidPhase(value: unknown): value is Phase {
  return typeof value === 'string' && VALID_PHASES.includes(value as Phase)
}

async function isInternalAuthorized(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get('x-internal-secret')
  const internalSecret = process.env.CRON_SECRET || process.env.SANDBOX_VERCEL_TOKEN
  if (internalSecret && secret === internalSecret) return true
  return false
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const { taskId, phase } = body

    if (typeof taskId !== 'string' || !isValidPhase(phase)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const internalAuthorized = await isInternalAuthorized(req)
    let userId: string | undefined

    if (!internalAuthorized) {
      const session = await getServerSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = session.user.id
    }

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), userId ? eq(tasks.userId, userId) : undefined, isNull(tasks.deletedAt)))
      .limit(1)

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    switch (phase) {
      case 'planner': {
        const apiKeys = await getUserApiKeys()
        const githubToken = await getUserGitHubToken()
        const githubUser = await getGitHubUser()
        const maxDuration = await getMaxSandboxDuration(task.userId)
        const { runTaskAsync } = await import('@/lib/sandbox/orchestrator')
        after(() => {
          runTaskAsync(
            taskId,
            task.prompt,
            task.repoUrl || '',
            (task.maxDuration as number) || maxDuration,
            (task.selectedAgent as string) || 'gateway',
            (task.selectedModel as string) || undefined,
            Boolean(task.installDependencies),
            Boolean(task.keepAlive),
            Boolean(task.enableBrowser),
            apiKeys,
            githubToken,
            githubUser,
            task.branchName as string | null,
          ).catch((e) => console.error('runTaskAsync failed:', e))
        })
        break
      }

      case 'execution': {
        const { runExecutionPhase } = await import('@/lib/sandbox/orchestrator')
        after(() => {
          runExecutionPhase(taskId).catch((e) => console.error('runExecutionPhase failed:', e))
        })
        break
      }

      case 'continue': {
        const [latestMessage] = await db
          .select()
          .from(taskMessages)
          .where(eq(taskMessages.taskId, taskId))
          .orderBy(desc(taskMessages.createdAt))
          .limit(1)

        if (!latestMessage || latestMessage.role !== 'user') {
          return NextResponse.json({ error: 'No user message found' }, { status: 400 })
        }

        const apiKeys = await getUserApiKeys()
        const githubToken = await getUserGitHubToken()
        const githubUser = await getGitHubUser()
        const maxDuration = await getMaxSandboxDuration(task.userId)
        const { continueTask } = await import('@/lib/sandbox/continue-task')
        after(() => {
          continueTask(
            taskId,
            latestMessage.content,
            task.repoUrl || '',
            task.branchName || '',
            (task.maxDuration as number) || maxDuration,
            (task.selectedAgent as string) || 'claude',
            (task.selectedModel as string) || undefined,
            Boolean(task.installDependencies),
            apiKeys,
            githubToken,
            githubUser,
          ).catch((e) => console.error('continueTask failed:', e))
        })
        break
      }

      case 'audio': {
        const { generateAudioSummary } = await import('@/lib/audio/generate-summary')
        after(() => {
          generateAudioSummary(taskId).catch((e) => console.error('generateAudioSummary failed:', e))
        })
        break
      }
    }

    return NextResponse.json({ ok: true, phase }, { status: 202 })
  } catch (error) {
    console.error('Internal run-phase error:', error)
    return NextResponse.json({ error: 'Failed to start phase' }, { status: 500 })
  }
}
