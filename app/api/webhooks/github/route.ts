import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db/client'
import { tasks, webhookEvents } from '@/lib/db/schema'
import { insertTaskSchema } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import { createFallbackBranchName } from '@/lib/utils/branch-name-generator'
import { createFallbackTitle } from '@/lib/utils/title-generator'

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
  const sender = body.sender as Record<string, unknown> | undefined
  const prompt = extractPrompt(body)

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

  if (!prompt || !repo) {
    return NextResponse.json({ ok: true, ignored: true, event })
  }

  const ownerLogin = (
    (body.repository as Record<string, unknown> | undefined)?.owner as Record<string, unknown> | undefined
  )?.login as string | undefined
  void sender
  void ownerLogin

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

    return NextResponse.json({ ok: true, task: created }, { status: 201 })
  } catch (error) {
    console.error('Webhook task creation failed:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
