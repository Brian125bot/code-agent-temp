import { Sandbox } from '@vercel/sandbox'
import { db } from '@/lib/db/client'
import { tasks, taskMessages, connectors } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { createTaskLogger } from '@/lib/utils/task-logger'
import { createSandbox } from '@/lib/sandbox/creation'
import { executeAgentInSandbox, AgentType } from '@/lib/sandbox/agents'
import { pushChangesToBranch, shutdownSandbox } from '@/lib/sandbox/git'
import { unregisterSandbox } from '@/lib/sandbox/sandbox-registry'
import { decrypt } from '@/lib/crypto'
import { getServerSession } from '@/lib/session/get-server-session'
import { generateCommitMessage, createFallbackCommitMessage } from '@/lib/utils/commit-message-generator'
import { detectPortFromRepo } from '@/lib/sandbox/port-detection'

export async function continueTask(
  taskId: string,
  prompt: string,
  repoUrl: string,
  branchName: string,
  maxDuration: number,
  selectedAgent: string = 'claude',
  selectedModel?: string,
  installDependencies: boolean = false,
  apiKeys?: {
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
    AI_GATEWAY_API_KEY?: string
  },
  githubToken?: string | null,
  githubUser?: {
    username: string
    name: string | null
    email: string | null
  } | null,
) {
  let sandbox: Sandbox | null = null
  let isResumedSandbox = false
  const logger = createTaskLogger(taskId)

  try {
    console.log('Continuing task with new message')

    await logger.updateStatus('processing', 'Processing follow-up message...')
    await logger.updateProgress(10, 'Initializing continuation...')

    if (githubToken) {
      await logger.info('Using authenticated GitHub access')
    }

    const [currentTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

    if (!currentTask) {
      throw new Error('Task not found')
    }

    console.log('Checking for existing sandbox:', {
      hasSandboxId: !!currentTask.sandboxId,
      sandboxId: currentTask.sandboxId,
      keepAlive: currentTask.keepAlive,
    })

    if (currentTask.sandboxId && currentTask.keepAlive) {
      try {
        await logger.info('Attempting to reconnect to existing sandbox')
        console.log('Calling Sandbox.get with sandboxId:', currentTask.sandboxId)
        const reconnectedSandbox = await Sandbox.get({
          sandboxId: currentTask.sandboxId,
          teamId: process.env.SANDBOX_VERCEL_TEAM_ID!,
          projectId: process.env.SANDBOX_VERCEL_PROJECT_ID!,
          token: process.env.SANDBOX_VERCEL_TOKEN!,
        })

        if (reconnectedSandbox) {
          await logger.info('Successfully reconnected to existing sandbox')
          sandbox = reconnectedSandbox
          isResumedSandbox = true
          await logger.updateProgress(50, 'Executing agent with follow-up message')
        }
      } catch (error) {
        console.error('Failed to reconnect to sandbox:', error)
        await logger.info('Could not reconnect to sandbox, will create new one')
      }
    }

    if (!sandbox) {
      await logger.updateProgress(15, 'Creating sandbox environment')
      console.log('Creating sandbox for continuation')

      const port = await detectPortFromRepo(repoUrl, githubToken)
      console.log(`Detected port ${port} for project`)

      const sandboxResult = await createSandbox(
        {
          taskId,
          repoUrl,
          githubToken,
          gitAuthorName: githubUser?.name || githubUser?.username || 'Coding Agent',
          gitAuthorEmail: githubUser?.username
            ? `${githubUser.username}@users.noreply.github.com`
            : 'agent@example.com',
          apiKeys,
          timeout: `${maxDuration}m`,
          ports: [port],
          runtime: 'node22',
          resources: { vcpus: 4 },
          taskPrompt: prompt,
          selectedAgent,
          selectedModel,
          installDependencies,
          preDeterminedBranchName: branchName,
          onProgress: async (progress: number, message: string) => {
            await logger.updateProgress(progress, message)
          },
        },
        logger,
      )

      if (!sandboxResult.success) {
        throw new Error(sandboxResult.error || 'Failed to create sandbox')
      }

      const { sandbox: createdSandbox, domain } = sandboxResult
      sandbox = createdSandbox || null

      await db
        .update(tasks)
        .set({
          sandboxId: sandbox?.sandboxId || undefined,
          sandboxUrl: domain || undefined,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId))
    }

    console.log('Starting agent execution')

    const previousMessages = await db
      .select()
      .from(taskMessages)
      .where(eq(taskMessages.taskId, taskId))
      .orderBy(asc(taskMessages.createdAt))
      .limit(10)

    const contextMessages = previousMessages.slice(-6, -1)

    const sanitizedPrompt = prompt.replace(/`/g, "'").replace(/\$/g, '').replace(/\\/g, '').replace(/^-/gm, ' -')

    let promptWithContext = sanitizedPrompt
    if (contextMessages.length > 0 && !isResumedSandbox) {
      let conversationHistory = '\n\n---\n\nFor context, here is the conversation history from this session:\n\n'
      contextMessages.forEach((msg) => {
        const role = msg.role === 'user' ? 'User' : 'A'
        const truncatedContent = msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content
        const sanitizedContent = truncatedContent
          .replace(/`/g, "'")
          .replace(/\$/g, '')
          .replace(/\\/g, '')
          .replace(/^-/gm, ' -')
        conversationHistory += `${role}: ${sanitizedContent}\n\n`
      })
      promptWithContext = `${sanitizedPrompt}${conversationHistory}`
    }

    type Connector = typeof connectors.$inferSelect

    let mcpServers: Connector[] = []

    try {
      const session = await getServerSession()

      if (session?.user?.id) {
        const userConnectors = await db
          .select()
          .from(connectors)
          .where(and(eq(connectors.userId, session.user.id), eq(connectors.status, 'connected')))

        mcpServers = userConnectors.map((connector: Connector) => {
          const decryptedEnv = connector.env ? JSON.parse(decrypt(connector.env)) : null
          return {
            ...connector,
            env: decryptedEnv,
            oauthClientSecret: connector.oauthClientSecret ? decrypt(connector.oauthClientSecret) : null,
          }
        })

        if (mcpServers.length > 0) {
          await logger.info('Found connected MCP servers')
        }
      }
    } catch (mcpError) {
      console.error('Failed to fetch MCP servers:', mcpError)
      await logger.info('Warning: Could not fetch MCP servers, continuing without them')
    }

    if (!sandbox) {
      throw new Error('Sandbox is not available for agent execution')
    }

    const agentMessageId = generateId()

    const agentResult = await executeAgentInSandbox(
      sandbox,
      promptWithContext,
      selectedAgent as AgentType,
      logger,
      selectedModel,
      mcpServers,
      undefined,
      apiKeys,
      isResumedSandbox,
      currentTask.agentSessionId || undefined,
      taskId,
      agentMessageId,
    )

    console.log('Agent execution completed')

    if (agentResult.sessionId) {
      await db.update(tasks).set({ agentSessionId: agentResult.sessionId }).where(eq(tasks.id, taskId))
    }

    if (agentResult.success) {
      await logger.success('Agent execution completed')
      await logger.info('Code changes applied successfully')

      if (agentResult.agentResponse) {
        await logger.info('Agent response received')

        try {
          await db.insert(taskMessages).values({
            id: generateId(12),
            taskId,
            role: 'agent',
            content: agentResult.agentResponse,
          })
        } catch (error) {
          console.error('Failed to save agent message:', error)
        }
      }

      let commitMessage: string
      try {
        let repoName: string | undefined
        try {
          const url = new URL(repoUrl)
          const pathParts = url.pathname.split('/')
          if (pathParts.length >= 3) {
            repoName = pathParts[pathParts.length - 1].replace(/\.git$/, '')
          }
        } catch {
          // Ignore URL parsing errors
        }

        if (process.env.AI_GATEWAY_API_KEY) {
          commitMessage = await generateCommitMessage({
            description: prompt,
            repoName,
            context: `${selectedAgent} agent follow-up`,
          })
        } else {
          commitMessage = createFallbackCommitMessage(prompt)
        }
      } catch (error) {
        console.error('Error generating commit message:', error)
        commitMessage = createFallbackCommitMessage(prompt)
      }

      const pushResult = await pushChangesToBranch(sandbox, branchName, commitMessage, logger)

      const [freshTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

      if (freshTask?.keepAlive) {
        await logger.info('Sandbox kept alive for follow-up messages')
      } else {
        unregisterSandbox(taskId)
        const shutdownResult = await shutdownSandbox(sandbox)
        if (shutdownResult.success) {
          await logger.success('Sandbox shutdown completed')
        } else {
          await logger.error('Sandbox shutdown failed')
        }
      }

      if (pushResult.pushFailed) {
        await logger.updateStatus('error')
        await logger.error('Task failed: Unable to push changes to repository')
        throw new Error('Failed to push changes to repository')
      } else {
        await logger.updateStatus('completed')
        await logger.updateProgress(100, 'Task completed successfully')
        console.log('Task continuation completed successfully')
      }
    } else {
      await logger.error('Agent execution failed')
      throw new Error(agentResult.error || 'Agent execution failed')
    }
  } catch (error) {
    console.error('Error continuing task:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    const errorStack = error instanceof Error ? error.stack : undefined

    console.error('Detailed error:', {
      message: errorMessage,
      stack: errorStack,
      taskId,
    })

    try {
      if (sandbox) {
        const [currentTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

        if (currentTask?.keepAlive) {
          await logger.info('Sandbox kept alive despite error')
        } else {
          unregisterSandbox(taskId)
          await shutdownSandbox(sandbox)
        }
      }
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError)
    }

    await logger.updateStatus('error')
    await logger.error('Task failed to continue')
    console.error('Task error details:', errorMessage)

    await db
      .update(tasks)
      .set({
        error: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
  }
}
