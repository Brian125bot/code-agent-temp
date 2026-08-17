import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db/client'
import { tasks, webhookEvents, prChecks } from '@/lib/db/schema'
import { insertTaskSchema } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import { createFallbackBranchName } from '@/lib/utils/branch-name-generator'
import { createFallbackTitle } from '@/lib/utils/title-generator'
import { getAppUrl } from '@/lib/utils/app-url'
import { eq, and } from 'drizzle-orm'

function verifySignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
  if (expected.length !== signature.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

function extractPrompt(body: Record<string, unknown>): string | null {
  const action = body.action as string | undefined
  const issue = body.issue as Record<string, unknown> | undefined
  const comment = body.comment as Record<string, unknown> | undefined

  if (comment?.body && typeof comment.body === 'string') {
    const m = comment.body.match(/\/jules\s+([\s\S]+)/i)
    if (m) return m[1].trim()
    if ((comment.body as string).toLowerCase().includes('/jules')) return comment.body as string
  }
  if (issue?.body && typeof issue.body === 'string' && issue.body.trim()) {
    if (action === 'opened' || action === 'labeled') return issue.body as string
  }
  return null
}

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  const rawBody = await req.text()

  if (secret) {
    const sig = req.headers.get('x-hub-signature-256')
    if (!verifySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = req.headers.get('x-github-event') || 'unknown'
  const repo = (body.repository as Record<string, unknown> | undefined)?.html_url as string | undefined

  const eventId = generateId(12)
  try {
    await db.insert(webhookEvents).values({
      id: eventId,
      provider: 'github',
      eventType: event,
      payload: body,
      taskId: null,
    })
  } catch {}

  if (event === 'check_run' || event === 'check_suite') {
    const checkRun = (body.check_run || body.check_suite) as
      | {
          id: number
          conclusion: string | null
          status: string
          name?: string
          head_sha?: string
          pull_requests?: { number: number }[]
        }
      | undefined
    if (checkRun) {
      const conclusion = checkRun.conclusion
      const status = checkRun.status
      if (
        status === 'completed' &&
        conclusion &&
        ['failure', 'cancelled', 'timed_out', 'action_required'].includes(conclusion)
      ) {
        const checkRunId = String(checkRun.id)
        const existing = await db.select().from(prChecks).where(eq(prChecks.checkRunId, checkRunId)).limit(1)
        if (existing[0]) {
          return NextResponse.json({ ok: true, ignored: true, reason: 'check_run already processed' })
        }

        let prNumber: number | undefined = checkRun.pull_requests?.[0]?.number
        if (!prNumber) {
          const prs = body.pull_request as { number?: number } | undefined
          if (prs?.number) prNumber = prs.number
        }

        let origTask: typeof tasks.$inferSelect | undefined
        if (prNumber && repo) {
          const candidates = await db
            .select()
            .from(tasks)
            .where(and(eq(tasks.prNumber, prNumber), eq(tasks.repoUrl, repo)))
            .limit(1)
          origTask = candidates[0]
        }
        if (!origTask && prNumber) {
          const candidates = await db.select().from(tasks).where(eq(tasks.prNumber, prNumber)).limit(1)
          origTask = candidates[0]
        }

        if (!origTask) {
          try {
            await db
              .insert(prChecks)
              .values({ id: generateId(12), taskId: eventId, checkRunId: checkRunId, conclusion })
          } catch {}
          return NextResponse.json({ ok: true, ignored: true, reason: 'no matching task' })
        }

        const attempt = origTask.autoFixAttempt ?? 0
        if (attempt >= 2) {
          try {
            const { getOctokit, parseGitHubUrl } = await import('@/lib/github/client')
            const parsed = origTask.repoUrl ? parseGitHubUrl(origTask.repoUrl) : null
            if (parsed && prNumber) {
              const octokit = await getOctokit()
              if ((octokit as unknown as { auth?: unknown }).auth) {
                await octokit.rest.issues.createComment({
                  owner: parsed.owner,
                  repo: parsed.repo,
                  issue_number: prNumber,
                  body: 'CI failed 3 times — human review needed. Auto-fix will not retry further.',
                })
              }
            }
          } catch {}
          try {
            await db
              .insert(prChecks)
              .values({ id: generateId(12), taskId: origTask.id, checkRunId: checkRunId, conclusion })
          } catch {}
          return NextResponse.json({ ok: true, ignored: true, reason: 'max attempts reached' })
        }

        let logSnippet = `Check "${checkRun.name || 'CI'}" concluded with ${conclusion}.`
        try {
          const { getOctokit, parseGitHubUrl } = await import('@/lib/github/client')
          const parsed = origTask.repoUrl ? parseGitHubUrl(origTask.repoUrl) : null
          if (parsed) {
            const octokit = await getOctokit()
            if ((octokit as unknown as { auth?: unknown }).auth && event === 'check_run') {
              try {
                const run = await octokit.rest.checks.get({
                  owner: parsed.owner,
                  repo: parsed.repo,
                  check_run_id: checkRun.id,
                })
                if (run.data.output?.text) logSnippet = run.data.output.text.slice(0, 6000)
                else if (run.data.output?.summary) logSnippet = run.data.output.summary.slice(0, 6000)
              } catch {}
            }
          }
        } catch {}

        const newId = generateId(12)
        const prompt = `CI failed on PR #${prNumber ?? '?'} (${conclusion}). Here's the log: ${logSnippet.slice(0, 3000)}. Fix it. Minimum change — one or two file edits at most. No scope creep.`
        const branchName = origTask.branchName || createFallbackBranchName(newId)

        try {
          const validated = insertTaskSchema.parse({
            id: newId,
            userId: origTask.userId,
            prompt,
            repoUrl: origTask.repoUrl || repo || '',
            selectedAgent: 'gateway',
            status: 'pending',
            progress: 0,
            logs: [],
            branchName,
            title: `Fix CI for #${prNumber ?? origTask.prNumber ?? '?'}`,
          })
          await db.insert(tasks).values({
            ...validated,
            id: newId,
            parentTaskId: origTask.id,
            autoFixAttempt: attempt + 1,
          } as never)
          await db.insert(prChecks).values({ id: generateId(12), taskId: newId, checkRunId: checkRunId, conclusion })
          await db
            .update(tasks)
            .set({ autoFixAttempt: attempt + 1 } as never)
            .where(eq(tasks.id, origTask.id))

          const runUrl = `${getAppUrl()}/api/internal/run-phase`
          fetch(runUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-secret': process.env.CRON_SECRET || process.env.SANDBOX_VERCEL_TOKEN || '',
            },
            body: JSON.stringify({ taskId: newId, phase: 'planner' }),
          }).catch((err) => console.error('Failed to trigger auto-fix planner:', err))

          try {
            await db.insert(webhookEvents).values({
              id: generateId(12),
              provider: 'github',
              eventType: `${event}:auto-fix-created`,
              payload: { taskId: newId, parentTaskId: origTask.id },
              taskId: newId,
            })
          } catch {}

          return NextResponse.json({ ok: true, autoFixTaskId: newId }, { status: 201 })
        } catch (error) {
          console.error('Auto-fix task creation failed:', error)
          return NextResponse.json({ error: 'Failed to create auto-fix task' }, { status: 500 })
        }
      }
    }
    // check_run not actionable — record pr_check for idempotency if needed
    if (checkRun) {
      try {
        await db.insert(prChecks).values({
          id: generateId(12),
          taskId: eventId,
          checkRunId: String(checkRun.id),
          conclusion: checkRun.conclusion || 'unknown',
        })
      } catch {}
    }
    return NextResponse.json({ ok: true, ignored: true, event })
  }

  const prompt = extractPrompt(body)
  if (!prompt || !repo) {
    return NextResponse.json({ ok: true, ignored: true, event })
  }

  const fallbackUserId = process.env.WEBHOOK_DEFAULT_USER_ID
  if (!fallbackUserId) {
    return NextResponse.json({ error: 'WEBHOOK_DEFAULT_USER_ID not configured' }, { status: 500 })
  }

  const taskId = generateId(12)
  const fallbackBranch = createFallbackBranchName(taskId)
  const fallbackTitle = createFallbackTitle(prompt)

  try {
    const validated = insertTaskSchema.parse({
      id: taskId,
      userId: fallbackUserId,
      prompt,
      repoUrl: repo,
      selectedAgent: 'gateway',
      status: 'pending',
      progress: 0,
      logs: [],
      branchName: fallbackBranch,
      title: fallbackTitle,
      webhookSource: { event, deliveryId: req.headers.get('x-github-delivery') || undefined },
    })

    const [created] = await db
      .insert(tasks)
      .values({ ...validated, id: taskId })
      .returning()

    await db
      .insert(webhookEvents)
      .values({
        id: generateId(12),
        provider: 'github',
        eventType: `${event}:task-created`,
        payload: { taskId },
        taskId,
      })
      .catch(() => {})

    const runUrl = `${getAppUrl()}/api/internal/run-phase`
    fetch(runUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': process.env.CRON_SECRET || process.env.SANDBOX_VERCEL_TOKEN || '',
      },
      body: JSON.stringify({ taskId, phase: 'planner' }),
    }).catch((err) => console.error('Failed to trigger webhook planner:', err))

    return NextResponse.json({ ok: true, task: created }, { status: 201 })
  } catch (error) {
    console.error('Webhook task creation failed:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
