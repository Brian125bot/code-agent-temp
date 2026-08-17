import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import { insertTaskSchema } from '@/lib/db/schema'
import { eq, desc, or, and, isNull } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { checkRateLimit } from '@/lib/utils/rate-limit'
import { getMaxSandboxDuration } from '@/lib/db/settings'
import { createFallbackBranchName } from '@/lib/utils/branch-name-generator'
import { createFallbackTitle } from '@/lib/utils/title-generator'
import { getAppUrl } from '@/lib/utils/app-url'
import { healStuckTasksByUser } from '@/lib/utils/heal-stuck-tasks'

export async function GET() {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Self-heal tasks that are stuck before sandbox creation
    await healStuckTasksByUser(session.user.id)

    const userTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.createdAt))
    return NextResponse.json({ tasks: userTasks })
  } catch (error) {
    console.error('Error fetching tasks:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    const body = await request.json()
    const taskId = body.id || generateId(12)

    const fallbackBranch = createFallbackBranchName(taskId)
    const fallbackTitle = createFallbackTitle(body.prompt || '')

    const validatedData = insertTaskSchema.parse({
      ...body,
      id: taskId,
      userId: session.user.id,
      status: 'pending',
      progress: 0,
      logs: [],
      branchName: body.branchName || fallbackBranch,
      title: body.title || fallbackTitle,
      gatewayModel: body.gatewayModel || body.selectedModel || undefined,
    })

    const maxSandboxDuration = await getMaxSandboxDuration(session.user.id)
    const effectiveMaxDuration = validatedData.maxDuration || maxSandboxDuration

    const [newTask] = await db
      .insert(tasks)
      .values({ ...validatedData, id: taskId, maxDuration: effectiveMaxDuration })
      .returning()

    const { generateBranchName } = await import('@/lib/utils/branch-name-generator')
    const { generateTaskTitle } = await import('@/lib/utils/title-generator')
    const hasGatewayKey = Boolean(process.env.AI_GATEWAY_API_KEY)

    if (hasGatewayKey && validatedData.prompt) {
      let repoName: string | undefined
      try {
        const url = new URL(validatedData.repoUrl || '')
        repoName = url.pathname
          .split('/')
          .pop()
          ?.replace(/\.git$/, '')
      } catch {}
      const branchPromise = generateBranchName({
        description: validatedData.prompt,
        repoName,
        context: `${validatedData.selectedAgent} agent task`,
      })
        .then(async (aiBranch) => {
          await db.update(tasks).set({ branchName: aiBranch, updatedAt: new Date() }).where(eq(tasks.id, taskId))
        })
        .catch(() => {})

      const titlePromise = generateTaskTitle({
        prompt: validatedData.prompt,
        repoName,
        context: `${validatedData.selectedAgent} agent task`,
      })
        .then(async (aiTitle) => {
          await db.update(tasks).set({ title: aiTitle, updatedAt: new Date() }).where(eq(tasks.id, taskId))
        })
        .catch(() => {})

      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3500))
      await Promise.race([Promise.allSettled([branchPromise, titlePromise]), timeout])
    }

    const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

    if (validatedData.selectedAgent === 'gateway' && validatedData.repoUrl) {
      const runUrl = `${getAppUrl()}/api/internal/run-phase`
      fetch(runUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: request.headers.get('cookie') || '',
        },
        body: JSON.stringify({ taskId, phase: 'planner' }),
      }).catch((err) => console.error('Failed to trigger planner phase:', err))
    }

    return NextResponse.json({ task: updatedTask || newTask }, { status: 201 })
  } catch (error) {
    console.error('Error creating task:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    if (!action) {
      return NextResponse.json({ error: 'Action parameter is required' }, { status: 400 })
    }
    const actions = action.split(',').map((a) => a.trim())
    const validActions = ['completed', 'failed', 'stopped']
    const invalidActions = actions.filter((a) => !validActions.includes(a))
    if (invalidActions.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid action(s): ${invalidActions.join(', ')}. Valid actions: ${validActions.join(', ')}`,
          status: 400,
        },
        { status: 400 },
      )
    }
    const statusConditions = []
    if (actions.includes('completed')) statusConditions.push(eq(tasks.status, 'completed'))
    if (actions.includes('failed')) statusConditions.push(eq(tasks.status, 'error'))
    if (actions.includes('stopped')) statusConditions.push(eq(tasks.status, 'stopped'))
    if (statusConditions.length === 0) {
      return NextResponse.json({ error: 'No valid actions specified' }, { status: 400 })
    }
    const statusClause = statusConditions.length === 1 ? statusConditions[0] : or(...statusConditions)
    const whereClause = and(statusClause, eq(tasks.userId, session.user.id))
    const deletedTasks = await db.delete(tasks).where(whereClause).returning()
    const actionMessages = []
    if (actions.includes('completed')) {
      const c = deletedTasks.filter((t) => t.status === 'completed').length
      if (c > 0) actionMessages.push(`${c} completed`)
    }
    if (actions.includes('failed')) {
      const c = deletedTasks.filter((t) => t.status === 'error').length
      if (c > 0) actionMessages.push(`${c} failed`)
    }
    if (actions.includes('stopped')) {
      const c = deletedTasks.filter((t) => t.status === 'stopped').length
      if (c > 0) actionMessages.push(`${c} stopped`)
    }
    const message =
      actionMessages.length > 0
        ? `${actionMessages.join(' and ')} task(s) deleted successfully`
        : 'No tasks found to delete'
    return NextResponse.json({ message, deletedCount: deletedTasks.length })
  } catch (error) {
    console.error('Error deleting tasks:', error)
    return NextResponse.json({ error: 'Failed to delete tasks' }, { status: 500 })
  }
}
