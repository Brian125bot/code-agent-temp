import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { tasks, connectors, taskMessages } from '@/lib/db/schema'
import { createSandbox } from './creation'
import { executeAgentInSandbox, AgentType } from './agents'
import { pushChangesToBranch, shutdownSandbox } from './git'
import { unregisterSandbox } from './sandbox-registry'
import { decrypt } from '@/lib/crypto'
import { getServerSession } from '@/lib/session/get-server-session'
import { createTaskLogger } from '@/lib/utils/task-logger'
import { generateCommitMessage, createFallbackCommitMessage } from '@/lib/utils/commit-message-generator'
import { detectPortFromRepo } from './port-detection'
import { generateId } from '@/lib/utils/id'

async function isTaskStopped(taskId: string): Promise<boolean> {
  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    return task?.status === 'stopped'
  } catch {
    return false
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

    const sandboxResult = await createSandbox(
      {
        taskId,
        repoUrl,
        githubToken,
        gitAuthorName: githubUser?.name || githubUser?.username || 'Coding Agent',
        gitAuthorEmail: githubUser?.username ? `${githubUser.username}@users.noreply.github.com` : 'agent@example.com',
        apiKeys,
        timeout: `${maxDuration}m`,
        ports: [port],
        runtime: 'node22',
        resources: { vcpus: 2 },
        taskPrompt: prompt,
        selectedAgent,
        selectedModel,
        installDependencies,
        keepAlive,
        enableBrowser,
        preDeterminedBranchName: branchName || undefined,
        onProgress: async (progress: number, message: string) => {
          await logger.updateProgress(progress, message)
        },
        onCancellationCheck: async () => await isTaskStopped(taskId),
      },
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
