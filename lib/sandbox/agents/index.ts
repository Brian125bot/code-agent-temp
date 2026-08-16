import { Sandbox } from '@vercel/sandbox'
import { AgentExecutionResult } from '../types'
import { executeClaudeInSandbox } from './claude'
import { executeCodexInSandbox } from './codex'
import { executeGatewayInSandbox } from './gateway'
import { TaskLogger } from '@/lib/utils/task-logger'
import { Connector } from '@/lib/db/schema'

export type AgentType = 'gateway' | 'claude' | 'codex' | 'copilot' | 'cursor' | 'gemini' | 'opencode'

// Re-export types
export type { AgentExecutionResult } from '../types'

// Main agent execution function
export async function executeAgentInSandbox(
  sandbox: Sandbox,
  instruction: string,
  agentType: AgentType,
  logger: TaskLogger,
  selectedModel?: string,
  mcpServers?: Connector[],
  onCancellationCheck?: () => Promise<boolean>,
  apiKeys?: {
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
    AI_GATEWAY_API_KEY?: string
  },
  isResumed?: boolean,
  sessionId?: string,
  taskId?: string,
  agentMessageId?: string,
): Promise<AgentExecutionResult> {
  // Check for cancellation before starting agent execution
  if (onCancellationCheck && (await onCancellationCheck())) {
    await logger.info('Task was cancelled before agent execution')
    return {
      success: false,
      error: 'Task was cancelled',
      cliName: agentType,
      changesDetected: false,
    }
  }

  // For Copilot agent, get the GitHub token from the user's GitHub account
  let githubToken: string | undefined
  if (agentType === 'copilot') {
    const { getUserGitHubToken } = await import('@/lib/github/user-token')
    githubToken = (await getUserGitHubToken()) || undefined
  }

  // Temporarily override process.env with user's API keys if provided
  const originalEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    GH_TOKEN: process.env.GH_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  }

  if (apiKeys?.OPENAI_API_KEY) process.env.OPENAI_API_KEY = apiKeys.OPENAI_API_KEY
  if (apiKeys?.GEMINI_API_KEY) process.env.GEMINI_API_KEY = apiKeys.GEMINI_API_KEY
  if (apiKeys?.CURSOR_API_KEY) process.env.CURSOR_API_KEY = apiKeys.CURSOR_API_KEY
  if (apiKeys?.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = apiKeys.ANTHROPIC_API_KEY
  if (apiKeys?.AI_GATEWAY_API_KEY) process.env.AI_GATEWAY_API_KEY = apiKeys.AI_GATEWAY_API_KEY
  if (githubToken) {
    process.env.GH_TOKEN = githubToken
    process.env.GITHUB_TOKEN = githubToken
  }

  try {
    switch (agentType) {
      case 'gateway':
        return await executeGatewayInSandbox(sandbox, instruction, logger, selectedModel)

      case 'claude':
        return await executeClaudeInSandbox(
          sandbox,
          instruction,
          logger,
          selectedModel,
          mcpServers,
          isResumed,
          sessionId,
          taskId,
          agentMessageId,
        )

      case 'codex':
        return await executeCodexInSandbox(
          sandbox,
          instruction,
          logger,
          selectedModel,
          mcpServers,
          isResumed,
          sessionId,
        )

      case 'copilot':
      case 'cursor':
      case 'gemini':
      case 'opencode': {
        if (!process.env.ENABLE_LEGACY_AGENTS) {
          return {
            success: false,
            error: `Legacy agent ${agentType} is disabled. Use gateway, claude, or codex via AI Gateway.`,
            cliName: agentType,
            changesDetected: false,
          }
        }
        const { executeCopilotInSandbox } = await import('./copilot')
        const { executeCursorInSandbox } = await import('./cursor')
        const { executeGeminiInSandbox } = await import('./gemini')
        const { executeOpenCodeInSandbox } = await import('./opencode')
        if (agentType === 'copilot')
          return await executeCopilotInSandbox(
            sandbox,
            instruction,
            logger,
            selectedModel,
            mcpServers,
            isResumed,
            sessionId,
            taskId,
          )
        if (agentType === 'cursor')
          return await executeCursorInSandbox(
            sandbox,
            instruction,
            logger,
            selectedModel,
            mcpServers,
            isResumed,
            sessionId,
            taskId,
          )
        if (agentType === 'gemini')
          return await executeGeminiInSandbox(sandbox, instruction, logger, selectedModel, mcpServers)
        return await executeOpenCodeInSandbox(
          sandbox,
          instruction,
          logger,
          selectedModel,
          mcpServers,
          isResumed,
          sessionId,
        )
      }

      default:
        return {
          success: false,
          error: `Unknown agent type: ${agentType}`,
          cliName: agentType,
          changesDetected: false,
        }
    }
  } finally {
    // Restore original environment variables
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY
    process.env.CURSOR_API_KEY = originalEnv.CURSOR_API_KEY
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY
    process.env.AI_GATEWAY_API_KEY = originalEnv.AI_GATEWAY_API_KEY
    process.env.GH_TOKEN = originalEnv.GH_TOKEN
    process.env.GITHUB_TOKEN = originalEnv.GITHUB_TOKEN
  }
}
