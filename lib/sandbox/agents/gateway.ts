import { Sandbox } from '@vercel/sandbox'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import { runCommandInSandbox, runInProject } from '../commands'
import { AgentExecutionResult } from '../types'
import { TaskLogger } from '@/lib/utils/task-logger'
import { GATEWAY_BASE_URL, GATEWAY_DEFAULT_MODEL } from '@/lib/constants'
import { db } from '@/lib/db/client'
import { taskMessages, steeringMessages } from '@/lib/db/schema'
import { eq, and, asc, isNull } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'

export async function executeGatewayInSandbox(
  sandbox: Sandbox,
  instruction: string,
  logger: TaskLogger,
  selectedModel?: string,
  taskId?: string,
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

  let steeringContext = ''
  let lastStepWrite = 0

  async function writeStepLog(toolName: string, args: unknown, result: string) {
    if (!taskId) return
    const now = Date.now()
    if (now - lastStepWrite < 500) return
    lastStepWrite = now
    try {
      const truncated = result.slice(0, 4000)
      const content = `[${toolName}] ${JSON.stringify(args).slice(0, 800)} → ${truncated}`
      await db.insert(taskMessages).values({
        id: generateId(12),
        taskId,
        role: 'agent',
        content: content.slice(0, 4000),
      })
    } catch {
      await logger.error('Failed to write step log')
    }
  }

  async function pollSteering(): Promise<string | null> {
    if (!taskId) return null
    try {
      const pendings = await db
        .select()
        .from(steeringMessages)
        .where(and(eq(steeringMessages.taskId, taskId), isNull(steeringMessages.appliedAt)))
        .orderBy(asc(steeringMessages.seq))
      if (pendings.length === 0) return null
      const block = pendings.map((p) => `[User steering]: ${p.body}`).join('\n')
      for (const p of pendings) {
        try {
          await db.update(steeringMessages).set({ appliedAt: new Date() }).where(eq(steeringMessages.id, p.id))
        } catch {}
      }
      return block
    } catch {
      return null
    }
  }

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
            const out = r.success ? (r.output?.slice(0, 20000) ?? '') : `Error: ${r.error}`
            await writeStepLog('readFile', { path }, out.slice(0, 4000))
            await logger.info('Gateway read file')
            return out
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
            if (r.success) {
              await logger.info('Gateway wrote file')
              await writeStepLog('writeFile', { path }, 'ok')
            } else {
              await logger.error('Gateway write failed')
              await writeStepLog('writeFile', { path }, `Error: ${r.error}`)
            }
            const steer = await pollSteering()
            if (steer) steeringContext += `\n${steer}`
            return r.success ? 'ok' : `Error: ${r.error}`
          },
        }),
        runCommand: tool({
          description: 'Run a shell command inside the project directory',
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            const effectiveCommand = steeringContext
              ? `${command}\n# Steering context:\n# ${steeringContext.slice(0, 500).replace(/\n/g, '\n# ')}`
              : command
            void effectiveCommand
            const r = await runInProject(sandbox, 'sh', ['-c', command])
            const out = `${r.output || ''}\n${r.error || ''}`.slice(0, 8000)
            await writeStepLog('runCommand', { command }, out.slice(0, 4000))
            await logger.info('Gateway ran command')
            const steer = await pollSteering()
            if (steer) steeringContext += `\n${steer}`
            return out || '(no output)'
          },
        }),
        listFiles: tool({
          description: 'List files matching a pattern',
          inputSchema: z.object({ pattern: z.string().optional() }),
          execute: async ({ pattern }) => {
            const args = pattern ? ['.', '-type', 'f', '-name', pattern] : ['.', '-type', 'f']
            const r = await runInProject(sandbox, 'find', args)
            const out = (r.output || '').slice(0, 6000)
            await writeStepLog('listFiles', { pattern }, out.slice(0, 4000))
            const steer = await pollSteering()
            if (steer) steeringContext += `\n${steer}`
            return out
          },
        }),
      },
      maxSteps: 25,
    } as Parameters<typeof generateText>[0] & { maxSteps: number })

    const text = (result as { text?: string }).text || ''
    if (text) await logger.info('Gateway response received')

    if (steeringContext) {
      try {
        await db.insert(taskMessages).values({
          id: generateId(12),
          taskId: taskId!,
          role: 'agent',
          content: `Steering applied during execution:\n${steeringContext.slice(0, 3000)}`,
        })
      } catch {}
    }

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
