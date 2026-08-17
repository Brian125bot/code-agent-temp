import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { tasks, connectors, taskMessages, plans } from '@/lib/db/schema'
import { provisionSandbox, setupSandbox } from './creation'
import { SandboxConfig, SandboxResult } from './types'
import { executeAgentInSandbox, AgentType } from './agents'
import { pushChangesToBranch, shutdownSandbox } from './git'
import { unregisterSandbox } from './sandbox-registry'
import { decrypt } from '@/lib/crypto'
import { getServerSession } from '@/lib/session/get-server-session'
import { createTaskLogger, TaskLogger } from '@/lib/utils/task-logger'
import { generateCommitMessage, createFallbackCommitMessage } from '@/lib/utils/commit-message-generator'
import { detectPortFromRepo } from './port-detection'
import { generateId } from '@/lib/utils/id'
import { runPlannerInSandbox } from './planner'
import { desc } from 'drizzle-orm'

async function isTaskStopped(taskId: string): Promise<boolean> {
  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    return task?.status === 'stopped'
  } catch {
    return false
  }
}

type SandboxRuntimeParams = {
  repoUrl: string
  githubToken: string | null | undefined
  githubUser: { username: string; name: string | null; email: string | null } | null | undefined
  apiKeys: {
    AI_GATEWAY_API_KEY?: string
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
  }
  timeout: string
  taskPrompt: string
  selectedAgent: string
  selectedModel?: string
  installDependencies: boolean
  keepAlive: boolean
  enableBrowser: boolean
  preDeterminedBranchName?: string
}

async function provisionAndSetup(
  taskId: string,
  params: SandboxRuntimeParams,
  port: number,
  logger: TaskLogger,
): Promise<SandboxResult> {
  const sandboxConfig: SandboxConfig = {
    taskId,
    repoUrl: params.repoUrl,
    githubToken: params.githubToken,
    gitAuthorName: params.githubUser?.name || params.githubUser?.username || 'Coding Agent',
    gitAuthorEmail: params.githubUser?.username
      ? `${params.githubUser.username}@users.noreply.github.com`
      : 'agent@example.com',
    apiKeys: params.apiKeys,
    timeout: params.timeout,
    ports: [port],
    runtime: 'node22',
    resources: { vcpus: 2 },
    taskPrompt: params.taskPrompt,
    selectedAgent: params.selectedAgent,
    selectedModel: params.selectedModel,
    installDependencies: params.installDependencies,
    keepAlive: params.keepAlive,
    enableBrowser: params.enableBrowser,
    preDeterminedBranchName: params.preDeterminedBranchName,
    onProgress: async (progress: number, message: string) => {
      await logger.updateProgress(progress, message)
    },
    onCancellationCheck: async () => await isTaskStopped(taskId),
  }

  const provisionResult = await provisionSandbox(sandboxConfig, logger)
  if (!provisionResult.success || !provisionResult.sandbox) {
    return provisionResult
  }

  // Persist the sandbox ID as soon as the VM exists so healers and reapers
  // never misclassify a live sandbox as a stuck task.
  await db
    .update(tasks)
    .set({ sandboxId: provisionResult.sandbox.sandboxId, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))

  if (await isTaskStopped(taskId)) {
    await logger.info('Task was stopped after sandbox creation')
    try {
      await shutdownSandbox(provisionResult.sandbox)
    } catch {}
    return { success: false, cancelled: true }
  }

  return setupSandbox(provisionResult.sandbox, sandboxConfig, logger)
}

export async function runPlannerPhase(
  taskId: string,
  prompt: string,
  repoUrl: string,
  maxDuration: number,
  githubToken: string | null | undefined,
  githubUser: { username: string; name: string | null; email: string | null } | null | undefined,
  apiKeys: {
    AI_GATEWAY_API_KEY?: string
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
  },
  branchName?: string | null,
) {
  let sandbox: import('@vercel/sandbox').Sandbox | null = null
  const logger = createTaskLogger(taskId)
  try {
    await logger.updateStatus('processing', 'Task created, preparing to start...')
    await logger.updateProgress(10, 'Initializing planner...')

    try {
      await db.insert(taskMessages).values({ id: generateId(12), taskId, role: 'user', content: prompt })
    } catch {}

    if (githubToken) await logger.info('Using authenticated GitHub access')

    const port = await detectPortFromRepo(repoUrl, githubToken)
    await logger.updateProgress(15, 'Creating sandbox environment')

    const sandboxResult = await provisionAndSetup(
      taskId,
      {
        repoUrl,
        githubToken,
        githubUser,
        apiKeys,
        timeout: `${Math.min(maxDuration, 5)}m`,
        taskPrompt: prompt,
        selectedAgent: 'gateway',
        selectedModel: undefined,
        installDependencies: false,
        keepAlive: false,
        enableBrowser: false,
        preDeterminedBranchName: branchName || undefined,
      },
      port,
      logger,
    )

    if (!sandboxResult.success) {
      if (sandboxResult.cancelled) {
        await logger.info('Task was cancelled during sandbox creation')
        return
      }
      throw new Error(sandboxResult.error || 'Failed to create sandbox')
    }

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped during sandbox creation')
      if (sandboxResult.sandbox) {
        try {
          await shutdownSandbox(sandboxResult.sandbox)
        } catch {}
      }
      return
    }

    const { sandbox: createdSandbox, branchName: createdBranch } = sandboxResult
    sandbox = createdSandbox || null

    if (!branchName && createdBranch) {
      await db
        .update(tasks)
        .set({ branchName: createdBranch, updatedAt: new Date() } as never)
        .where(eq(tasks.id, taskId))
    }

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped before planner execution')
      return
    }

    await logger.updateProgress(50, 'Generating plan')
    if (!sandbox) throw new Error('Sandbox is not available for planner')

    const planResult = await runPlannerInSandbox({ sandbox, instruction: prompt, logger, taskId })

    const nextVersion = await db
      .select()
      .from(plans)
      .where(eq(plans.taskId, taskId))
      .orderBy(desc(plans.version))
      .limit(1)
      .then((rows) => (rows[0] ? rows[0].version + 1 : 1))

    await db.insert(plans).values({
      id: generateId(12),
      taskId,
      version: nextVersion,
      content: planResult as unknown as Record<string, unknown>,
      authoredBy: 'agent',
    })

    await db
      .update(tasks)
      .set({ status: 'awaiting_approval' as never, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))

    await logger.info('Plan generated')

    unregisterSandbox(taskId)
    try {
      await shutdownSandbox(sandbox)
    } catch {}
  } catch (error) {
    if (sandbox) {
      try {
        unregisterSandbox(taskId)
        await shutdownSandbox(sandbox)
      } catch {}
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    await logger.error('Error occurred during planner phase')
    await logger.updateStatus('error', errorMessage)
  }
}

export async function runExecutionPhase(taskId: string) {
  const logger = createTaskLogger(taskId)
  let sandbox: import('@vercel/sandbox').Sandbox | null = null
  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'awaiting_approval' && task.status !== 'pending') {
      throw new Error('Task is not awaiting approval')
    }

    const planRows = await db.select().from(plans).where(eq(plans.taskId, taskId)).orderBy(desc(plans.version)).limit(1)
    const planContent = planRows[0]?.content as Record<string, unknown> | undefined

    const repoUrl = task.repoUrl || ''
    const branchName = task.branchName || ''
    const prompt = task.prompt || ''
    const maxDuration = task.maxDuration || 60
    const selectedAgent = (task.selectedAgent as AgentType) || 'gateway'
    const selectedModel = task.selectedModel || undefined

    const { getUserApiKeys } = await import('@/lib/api-keys/user-keys')
    const { getUserGitHubToken } = await import('@/lib/github/user-token')
    const { getGitHubUser } = await import('@/lib/github/client')
    const apiKeys = await getUserApiKeys()
    const githubToken = await getUserGitHubToken()
    const githubUser = await getGitHubUser()

    await logger.updateStatus('processing', 'Plan approved, starting execution...')
    await logger.updateProgress(10, 'Initializing task execution...')

    if (githubToken) await logger.info('Using authenticated GitHub access')

    const port = await detectPortFromRepo(repoUrl, githubToken)
    await logger.updateProgress(15, 'Creating sandbox environment')

    const sandboxResult = await provisionAndSetup(
      taskId,
      {
        repoUrl,
        githubToken,
        githubUser,
        apiKeys,
        timeout: `${maxDuration}m`,
        taskPrompt: prompt,
        selectedAgent,
        selectedModel,
        installDependencies: task.installDependencies || false,
        keepAlive: task.keepAlive || false,
        enableBrowser: task.enableBrowser || false,
        preDeterminedBranchName: branchName || undefined,
      },
      port,
      logger,
    )

    if (!sandboxResult.success) {
      if (sandboxResult.cancelled) {
        await logger.info('Task was cancelled during sandbox creation')
        return
      }
      throw new Error(sandboxResult.error || 'Failed to create sandbox')
    }

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped during sandbox creation')
      if (sandboxResult.sandbox) {
        try {
          await shutdownSandbox(sandboxResult.sandbox)
        } catch {}
      }
      return
    }

    const { sandbox: createdSandbox, domain, branchName: createdBranch } = sandboxResult
    sandbox = createdSandbox || null

    const updateData: Record<string, unknown> = {
      sandboxId: sandbox?.sandboxId || undefined,
      sandboxUrl: domain || undefined,
      updatedAt: new Date(),
    }
    if (!branchName) updateData.branchName = createdBranch
    await db
      .update(tasks)
      .set(updateData as never)
      .where(eq(tasks.id, taskId))

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped before agent execution')
      return
    }

    await logger.updateProgress(50, 'Installing and executing agent')
    if (!sandbox) throw new Error('Sandbox is not available for agent execution')

    type Connector = typeof connectors.$inferSelect
    let mcpServers: Connector[] = []
    try {
      const session = await getServerSession()
      if (session?.user?.id) {
        const userConnectors = await db.select().from(connectors).where(eq(connectors.userId, session.user.id))
        mcpServers = userConnectors
          .filter((c) => c.status === 'connected')
          .map((connector: Connector) => ({
            ...connector,
            env: connector.env ? JSON.parse(decrypt(connector.env)) : null,
            oauthClientSecret: connector.oauthClientSecret ? decrypt(connector.oauthClientSecret) : null,
          }))
        if (mcpServers.length > 0) {
          await db
            .update(tasks)
            .set({
              mcpServerIds: JSON.parse(JSON.stringify(mcpServers.map((s) => s.id))),
              updatedAt: new Date(),
            } as never)
            .where(eq(tasks.id, taskId))
        }
      }
    } catch {}

    const sanitizedPrompt = prompt.replace(/`/g, "'").replace(/\$/g, '').replace(/\\/g, '').replace(/^-/gm, ' -')
    const planSuffix = planContent ? `\n\nApproved plan:\n${JSON.stringify(planContent, null, 2)}` : ''
    const fullPrompt = `${sanitizedPrompt}${planSuffix}`

    const agentMessageId = generateId()
    const branch = (createdBranch || branchName) as string

    const agentResult = await executeAgentInSandbox(
      sandbox,
      fullPrompt,
      selectedAgent,
      logger,
      selectedModel,
      mcpServers,
      undefined,
      apiKeys,
      undefined,
      undefined,
      taskId,
      agentMessageId,
    )

    if (agentResult.sessionId) {
      await db
        .update(tasks)
        .set({ agentSessionId: agentResult.sessionId } as never)
        .where(eq(tasks.id, taskId))
    }

    if (agentResult.success) {
      await logger.success('Agent execution completed')
      if (agentResult.agentResponse) {
        try {
          await db
            .insert(taskMessages)
            .values({ id: generateId(12), taskId, role: 'agent', content: agentResult.agentResponse })
        } catch {}
      }

      let commitMessage: string
      try {
        let repoName: string | undefined
        try {
          const url = new URL(repoUrl)
          repoName = url.pathname
            .split('/')
            .pop()
            ?.replace(/\.git$/, '')
        } catch {}
        if (process.env.AI_GATEWAY_API_KEY) {
          commitMessage = await generateCommitMessage({
            description: prompt,
            repoName,
            context: `${selectedAgent} agent task`,
          })
        } else {
          commitMessage = createFallbackCommitMessage(prompt)
        }
      } catch {
        commitMessage = createFallbackCommitMessage(prompt)
      }

      const pushResult = await pushChangesToBranch(sandbox!, branch, commitMessage, logger)

      try {
        const { audioSummaries } = await import('@/lib/db/schema')
        const { desc: desc2 } = await import('drizzle-orm')
        const audios = await db
          .select()
          .from(audioSummaries)
          .where(eq(audioSummaries.taskId, taskId))
          .orderBy(desc2(audioSummaries.createdAt))
          .limit(1)
        void audios
      } catch {}

      if (task.keepAlive) {
        await logger.info('Sandbox kept alive for follow-up messages')
      } else {
        unregisterSandbox(taskId)
        const shutdownResult = await shutdownSandbox(sandbox!)
        if (shutdownResult.success) await logger.success('Sandbox shutdown completed')
        else await logger.error('Sandbox shutdown failed')
      }

      try {
        const { getOctokit, parseGitHubUrl } = await import('@/lib/github/client')
        const parsed = parseGitHubUrl(repoUrl)
        if (parsed && branch) {
          const octokit = await getOctokit()
          if ((octokit as unknown as { auth?: unknown }).auth) {
            let body = prompt.slice(0, 2000)
            try {
              const { audioSummaries: aTable } = await import('@/lib/db/schema')
              const rows = await db.select().from(aTable).where(eq(aTable.taskId, taskId)).limit(1)
              if (rows[0]?.blobUrl) {
                body += `\n\n---\n🎧 [Listen](${rows[0].blobUrl}) (${rows[0].durationSec ?? '?'}s) — AI-generated changelog`
              }
            } catch {}
            try {
              const prRes = await octokit.rest.pulls.create({
                owner: parsed.owner,
                repo: parsed.repo,
                title: task.title || prompt.slice(0, 80),
                body,
                head: branch,
                base: 'main',
              })
              await db
                .update(tasks)
                .set({
                  prUrl: prRes.data.html_url,
                  prNumber: prRes.data.number,
                  prStatus: 'open' as never,
                  updatedAt: new Date(),
                } as never)
                .where(eq(tasks.id, taskId))
            } catch {}
          }
        }
      } catch {}

      if (pushResult.pushFailed) {
        await logger.updateStatus('error')
        await logger.error('Task failed: Unable to push changes to repository')
        throw new Error('Failed to push changes to repository')
      } else {
        await logger.updateStatus('completed')
        await logger.updateProgress(100, 'Task completed successfully')
      }
    } else {
      await logger.error('Agent execution failed')
      throw new Error(agentResult.error || 'Agent execution failed')
    }
  } catch (error) {
    if (sandbox) {
      try {
        const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
        if (t?.keepAlive) await logger.info('Sandbox kept alive despite error')
        else {
          unregisterSandbox(taskId)
          await shutdownSandbox(sandbox)
        }
      } catch {}
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    await logger.error('Error occurred during task processing')
    await logger.updateStatus('error', errorMessage)
  }
}

export async function runTaskAsync(
  taskId: string,
  prompt: string,
  repoUrl: string,
  maxDuration: number,
  selectedAgent: string,
  selectedModel: string | undefined,
  installDependencies: boolean,
  keepAlive: boolean,
  enableBrowser: boolean,
  apiKeys: {
    AI_GATEWAY_API_KEY?: string
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
  },
  githubToken: string | null | undefined,
  githubUser: { username: string; name: string | null; email: string | null } | null | undefined,
  branchName?: string | null,
) {
  if (selectedAgent === 'gateway') {
    return runPlannerPhase(taskId, prompt, repoUrl, maxDuration, githubToken, githubUser, apiKeys, branchName)
  }

  let sandbox: import('@vercel/sandbox').Sandbox | null = null
  const logger = createTaskLogger(taskId)
  try {
    await logger.updateStatus('processing', 'Task created, preparing to start...')
    await logger.updateProgress(10, 'Initializing task execution...')

    try {
      await db.insert(taskMessages).values({ id: generateId(12), taskId, role: 'user', content: prompt })
    } catch {}

    if (githubToken) await logger.info('Using authenticated GitHub access')

    const port = await detectPortFromRepo(repoUrl, githubToken)
    await logger.updateProgress(15, 'Creating sandbox environment')

    const sandboxResult = await provisionAndSetup(
      taskId,
      {
        repoUrl,
        githubToken,
        githubUser,
        apiKeys,
        timeout: `${maxDuration}m`,
        taskPrompt: prompt,
        selectedAgent,
        selectedModel,
        installDependencies,
        keepAlive,
        enableBrowser,
        preDeterminedBranchName: branchName || undefined,
      },
      port,
      logger,
    )

    if (!sandboxResult.success) {
      if (sandboxResult.cancelled) {
        await logger.info('Task was cancelled during sandbox creation')
        return
      }
      throw new Error(sandboxResult.error || 'Failed to create sandbox')
    }

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped during sandbox creation')
      if (sandboxResult.sandbox) {
        try {
          await shutdownSandbox(sandboxResult.sandbox)
        } catch {}
      }
      return
    }

    const { sandbox: createdSandbox, domain, branchName: createdBranch } = sandboxResult
    sandbox = createdSandbox || null

    const updateData: Record<string, unknown> = {
      sandboxId: sandbox?.sandboxId || undefined,
      sandboxUrl: domain || undefined,
      updatedAt: new Date(),
    }
    if (!branchName) updateData.branchName = createdBranch
    await db
      .update(tasks)
      .set(updateData as never)
      .where(eq(tasks.id, taskId))

    if (await isTaskStopped(taskId)) {
      await logger.info('Task was stopped before agent execution')
      return
    }

    await logger.updateProgress(50, 'Installing and executing agent')
    if (!sandbox) throw new Error('Sandbox is not available for agent execution')

    type Connector = typeof connectors.$inferSelect
    let mcpServers: Connector[] = []
    try {
      const session = await getServerSession()
      if (session?.user?.id) {
        const userConnectors = await db.select().from(connectors).where(eq(connectors.userId, session.user.id))
        mcpServers = userConnectors
          .filter((c) => c.status === 'connected')
          .map((connector: Connector) => ({
            ...connector,
            env: connector.env ? JSON.parse(decrypt(connector.env)) : null,
            oauthClientSecret: connector.oauthClientSecret ? decrypt(connector.oauthClientSecret) : null,
          }))
        if (mcpServers.length > 0) {
          await db
            .update(tasks)
            .set({
              mcpServerIds: JSON.parse(JSON.stringify(mcpServers.map((s) => s.id))),
              updatedAt: new Date(),
            } as never)
            .where(eq(tasks.id, taskId))
        }
      }
    } catch {}

    const sanitizedPrompt = prompt.replace(/`/g, "'").replace(/\$/g, '').replace(/\\/g, '').replace(/^-/gm, ' -')

    const agentMessageId = generateId()
    const branch = (createdBranch || branchName) as string

    const agentResult = await executeAgentInSandbox(
      sandbox,
      sanitizedPrompt,
      (selectedAgent as AgentType) || 'gateway',
      logger,
      selectedModel,
      mcpServers,
      undefined,
      apiKeys,
      undefined,
      undefined,
      taskId,
      agentMessageId,
    )

    if (agentResult.sessionId) {
      await db
        .update(tasks)
        .set({ agentSessionId: agentResult.sessionId } as never)
        .where(eq(tasks.id, taskId))
    }

    if (agentResult.success) {
      await logger.success('Agent execution completed')
      if (agentResult.agentResponse) {
        try {
          await db
            .insert(taskMessages)
            .values({ id: generateId(12), taskId, role: 'agent', content: agentResult.agentResponse })
        } catch {}
      }

      let commitMessage: string
      try {
        let repoName: string | undefined
        try {
          const url = new URL(repoUrl)
          repoName = url.pathname
            .split('/')
            .pop()
            ?.replace(/\.git$/, '')
        } catch {}
        if (process.env.AI_GATEWAY_API_KEY) {
          commitMessage = await generateCommitMessage({
            description: prompt,
            repoName,
            context: `${selectedAgent} agent task`,
          })
        } else {
          commitMessage = createFallbackCommitMessage(prompt)
        }
      } catch {
        commitMessage = createFallbackCommitMessage(prompt)
      }

      const pushResult = await pushChangesToBranch(sandbox!, branch, commitMessage, logger)

      if (keepAlive) {
        await logger.info('Sandbox kept alive for follow-up messages')
      } else {
        unregisterSandbox(taskId)
        const shutdownResult = await shutdownSandbox(sandbox!)
        if (shutdownResult.success) await logger.success('Sandbox shutdown completed')
        else await logger.error('Sandbox shutdown failed')
      }

      if (pushResult.pushFailed) {
        await logger.updateStatus('error')
        await logger.error('Task failed: Unable to push changes to repository')
        throw new Error('Failed to push changes to repository')
      } else {
        await logger.updateStatus('completed')
        await logger.updateProgress(100, 'Task completed successfully')
      }
    } else {
      await logger.error('Agent execution failed')
      throw new Error(agentResult.error || 'Agent execution failed')
    }
  } catch (error) {
    if (sandbox) {
      try {
        if (keepAlive) await logger.info('Sandbox kept alive despite error')
        else {
          unregisterSandbox(taskId)
          await shutdownSandbox(sandbox)
        }
      } catch {}
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    await logger.error('Error occurred during task processing')
    await logger.updateStatus('error', errorMessage)
  }
}
