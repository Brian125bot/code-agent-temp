import { Sandbox } from '@vercel/sandbox'
import { generateObject, generateText, tool } from 'ai'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runInProject } from './commands'
import { TaskLogger } from '@/lib/utils/task-logger'
import { db } from '@/lib/db/client'
import { taskMessages } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import { planSchema, type PlanResult } from '@/lib/plans/schema'

export { planSchema, planStepSchema, type PlanResult, type PlanStep } from '@/lib/plans/schema'

function loadPlannerPrompt(): string {
  try {
    return readFileSync(join(process.cwd(), 'lib/sandbox/prompts/planner-system-prompt.md'), 'utf-8')
  } catch {
    return 'You are a senior staff engineer. Produce a minimal, read-only plan. Explore the repo, be honest about risk, keep changes small.'
  }
}

export async function runPlannerInSandbox({
  sandbox,
  instruction,
  logger,
  taskId,
}: {
  sandbox: Sandbox
  instruction: string
  logger: TaskLogger
  taskId?: string
}): Promise<PlanResult> {
  const model = 'google/gemini-2.5-pro'
  const systemPrompt = loadPlannerPrompt()

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

  const isAutoFix = instruction.trimStart().startsWith('CI failed')

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

  // First, let the agent explore with tools via generateText
  const explorePrompt = `Project file list (truncated):\n${snapshotText}\n\nInstruction:\n${instruction}${isAutoFix ? '\n\n[Auto-fix mode: maximum 3 steps, 2 files, minimum change to fix CI. No scope creep.]' : ''}\n\nExplore the repository using the tools, then you will be asked to produce a structured plan.`

  let exploreContext = ''
  try {
    const exploreResult = await generateText({
      model,
      system: systemPrompt,
      prompt: explorePrompt,
      tools: {
        readFile: tool({
          description: 'Read a file from the sandbox project (read-only)',
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            const r = await runInProject(sandbox, 'cat', [path])
            const out = r.success ? (r.output?.slice(0, 10000) ?? '') : `Error: ${r.error}`
            await writeStepLog('readFile', { path }, out.slice(0, 4000))
            await logger.info('Planner read file')
            exploreContext += `\n[readFile ${path}]: ${out.slice(0, 2000)}`
            return out
          },
        }),
        listFiles: tool({
          description: 'List files matching a pattern (read-only)',
          inputSchema: z.object({ pattern: z.string().optional() }),
          execute: async ({ pattern }) => {
            const args = pattern ? ['.', '-type', 'f', '-name', pattern] : ['.', '-type', 'f']
            const r = await runInProject(sandbox, 'find', args)
            const out = (r.output || '').slice(0, 6000)
            await writeStepLog('listFiles', { pattern }, out.slice(0, 4000))
            exploreContext += `\n[listFiles ${pattern || '*'}]: ${out.slice(0, 2000)}`
            return out
          },
        }),
        runCommand: tool({
          description: 'Run a read-only shell command (cat, ls, grep, git status)',
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            const r = await runInProject(sandbox, 'sh', ['-c', command])
            const out = `${r.output || ''}\n${r.error || ''}`.slice(0, 8000)
            await writeStepLog('runCommand', { command }, out.slice(0, 4000))
            exploreContext += `\n[runCommand ${command}]: ${out.slice(0, 2000)}`
            return out || '(no output)'
          },
        }),
      },
      maxSteps: 12,
    } as unknown as Parameters<typeof generateText>[0])
    const exploreText = (exploreResult as { text?: string }).text || ''
    if (exploreText) exploreContext += `\n${exploreText.slice(0, 4000)}`
  } catch {
    // explore failed, continue with snapshot only
  }

  // Now generate structured plan with full context
  try {
    const planPrompt = `Project file list:\n${snapshotText}\n\nExploration context:\n${exploreContext.slice(0, 8000)}\n\nInstruction:\n${instruction}\n\nProduce a structured plan for this instruction.`

    const { object } = await generateObject({
      model,
      system: systemPrompt,
      prompt: planPrompt,
      schema: planSchema,
    })

    let validated = planSchema.parse(object)
    if (isAutoFix && validated.steps.length > 3) {
      validated.steps = validated.steps.slice(0, 3)
    }
    return validated
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Planner failed'
    await logger.error('Planner error')
    throw new Error(msg)
  }
}
