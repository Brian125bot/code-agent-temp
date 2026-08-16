import { Writable } from 'stream'
import { Sandbox } from '@vercel/sandbox'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { runCommandInSandbox, runInProject, PROJECT_DIR } from '../commands'
import { AgentExecutionResult } from '../types'
import { TaskLogger } from '@/lib/utils/task-logger'
import { GATEWAY_BASE_URL, GATEWAY_DEFAULT_MODEL } from '@/lib/constants'

export async function executeGatewayInSandbox(
  sandbox: Sandbox,
  instruction: string,
  logger: TaskLogger,
  selectedModel?: string,
): Promise<AgentExecutionResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) {
    return {
      success: false,
      error: 'AI_GATEWAY_API_KEY is required for Gateway agent',
      cliName: 'gateway',
      changesDetected: false,
    }
  }

  const model = selectedModel || GATEWAY_DEFAULT_MODEL
  await logger.info('Starting Gateway agent')

  const fileSnapshot = await runInProject(sandbox, 'find', [
    '.',
    '-type',
    'f',
    '-not',
    '-path',
    '*/.git/*',
    '-not',
    '-path',
    '*/node_modules/*',
  ])
  const snapshotText = fileSnapshot.output?.slice(0, 8000) || 'No files found'

  const systemPrompt = `You are an autonomous coding agent running via Vercel AI Gateway (base ${GATEWAY_BASE_URL}). You work inside /vercel/sandbox/project. Edit files to satisfy the user's instruction. Use the tools provided to read, write, and run commands. Be concise and make minimal correct changes.`

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: `Project file list (truncated):\n${snapshotText}\n\nInstruction:\n${instruction}`,
      tools: {
        readFile: tool({
          description: 'Read a file from the sandbox project',
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            const r = await runInProject(sandbox, 'cat', [path])
            await logger.info('Gateway read file')
            return r.success ? r.output?.slice(0, 20000) : `Error: ${r.error}`
          },
        }),
        writeFile: tool({
          description: 'Write content to a file in the sandbox project',
          inputSchema: z.object({ path: z.string(), content: z.string() }),
          execute: async ({ path, content }) => {
            const escaped = content.replace(/'/g, "'\\''")
            const r = await runCommandInSandbox(sandbox, 'sh', [
              '-c',
              `mkdir -p "$(dirname '${path.replace(/'/g, "'\\''")}')" && cat > '${path.replace(/'/g, "'\\''")}' << 'GATEWAY_EOF'\n${escaped}\nGATEWAY_EOF`,
            ])
            if (r.success) await logger.info('Gateway wrote file')
            else await logger.error('Gateway write failed')
            return r.success ? 'ok' : `Error: ${r.error}`
          },
        }),
        runCommand: tool({
          description: 'Run a shell command inside the project directory',
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            const r = await runInProject(sandbox, 'sh', ['-c', command])
            const out = `${r.output || ''}\n${r.error || ''}`.slice(0, 8000)
            await logger.info('Gateway ran command')
            return out || '(no output)'
          },
        }),
        listFiles: tool({
          description: 'List files matching a pattern',
          inputSchema: z.object({ pattern: z.string().optional() }),
          execute: async ({ pattern }) => {
            const args = pattern ? ['.', '-type', 'f', '-name', pattern] : ['.', '-type', 'f']
            const r = await runInProject(sandbox, 'find', args)
            return (r.output || '').slice(0, 6000)
          },
        }),
      },
      maxSteps: 25,
    } as Parameters<typeof generateText>[0] & { maxSteps: number })

    const text = (result as { text?: string }).text || ''
    if (text) await logger.info('Gateway response received')

    const gitStatus = await runInProject(sandbox, 'git', ['status', '--porcelain'])
    const hasChanges = Boolean(gitStatus.success && gitStatus.output?.trim())

    return {
      success: true,
      output: text.slice(0, 4000) || 'Gateway agent completed',
      agentResponse: text || undefined,
      cliName: 'gateway',
      changesDetected: hasChanges,
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Gateway agent failed'
    await logger.error('Gateway agent error')
    return { success: false, error: msg, cliName: 'gateway', changesDetected: false }
  }
}
