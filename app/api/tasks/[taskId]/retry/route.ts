import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { AppError } from '@/lib/utils/errors'

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
    if (task.status !== 'error' && task.status !== 'stopped') {
      return NextResponse.json(
        { error: 'Can only retry failed or stopped tasks', code: 'INVALID_STATE' },
        { status: 400 },
      )
    }

    await db
      .update(tasks)
      .set({ status: 'pending' as never, error: null, progress: 0, updatedAt: new Date(), completedAt: null } as never)
      .where(eq(tasks.id, taskId))

    const { after } = await import('next/server')
    after(async () => {
      try {
        const { getUserApiKeys } = await import('@/lib/api-keys/user-keys')
        const { getUserGitHubToken } = await import('@/lib/github/user-token')
        const { getGitHubUser } = await import('@/lib/github/client')
        const { getMaxSandboxDuration } = await import('@/lib/db/settings')
        const apiKeys = await getUserApiKeys()
        const githubToken = await getUserGitHubToken()
        const githubUser = await getGitHubUser()
        const maxDurationSetting = await getMaxSandboxDuration(session.user.id)

        if (task.selectedAgent === 'gateway') {
          const { runPlannerPhase } = await import('@/lib/sandbox/orchestrator')
          await runPlannerPhase(
            taskId,
            task.prompt,
            task.repoUrl || '',
            task.maxDuration || maxDurationSetting,
            githubToken,
            githubUser,
            apiKeys,
            task.branchName,
          )
        } else {
          const { runTaskAsync } = await import('@/lib/sandbox/orchestrator')
          await runTaskAsync(
            taskId,
            task.prompt,
            task.repoUrl || '',
            task.maxDuration || maxDurationSetting,
            task.selectedAgent || 'gateway',
            task.selectedModel || undefined,
            task.installDependencies || false,
            task.keepAlive || false,
            task.enableBrowser || false,
            apiKeys,
            githubToken,
            githubUser,
            task.branchName,
          )
        }
      } catch (error) {
        console.error('Error retrying task:', error)
      }
    })

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    return NextResponse.json({ task: updated })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error retrying task:', error)
    return NextResponse.json({ error: 'Failed to retry task', code: 'INTERNAL' }, { status: 500 })
  }
}
