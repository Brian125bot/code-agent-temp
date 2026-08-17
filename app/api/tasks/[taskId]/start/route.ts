import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { getUserGitHubToken } from '@/lib/github/user-token'
import { getGitHubUser } from '@/lib/github/client'
import { getUserApiKeys } from '@/lib/api-keys/user-keys'
import { getMaxSandboxDuration } from '@/lib/db/settings'

export async function POST(_req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { taskId } = await context.params
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (task.status === 'processing') {
      return NextResponse.json({ task, message: 'Already processing' })
    }
    if (['completed', 'error'].includes(task.status)) {
      await db
        .update(tasks)
        .set({ status: 'processing', progress: 0, updatedAt: new Date() })
        .where(eq(tasks.id, taskId))
    }

    const userApiKeys = await getUserApiKeys()
    const userGithubToken = await getUserGitHubToken()
    const githubUser = await getGitHubUser()
    const maxSandboxDuration = await getMaxSandboxDuration(session.user.id)

    const { runTaskAsync } = await import('@/lib/sandbox/orchestrator')

    const effectiveAgent = (task.selectedAgent as string) || 'gateway'
    const effectiveModel = (task.gatewayModel as string) || (task.selectedModel as string) || undefined

    after(() => {
      runTaskAsync(
        task.id,
        task.prompt,
        task.repoUrl || '',
        (task.maxDuration as number) || maxSandboxDuration,
        effectiveAgent,
        effectiveModel,
        Boolean(task.installDependencies),
        Boolean(task.keepAlive),
        Boolean(task.enableBrowser),
        userApiKeys,
        userGithubToken,
        githubUser,
        task.branchName as string | null,
      ).catch((e) => console.error('runTaskAsync failed:', e))
    })

    return NextResponse.json({ task: { ...task, status: 'processing' as const }, message: 'Task started' })
  } catch (error) {
    console.error('Error starting task:', error)
    return NextResponse.json({ error: 'Failed to start task' }, { status: 500 })
  }
}
