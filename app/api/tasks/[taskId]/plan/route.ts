import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { tasks, plans } from '@/lib/db/schema'
import { eq, and, isNull, desc } from 'drizzle-orm'
import { getServerSession } from '@/lib/session/get-server-session'
import { planSchema } from '@/lib/plans/schema'
import { generateId } from '@/lib/utils/id'
import { PlanSchemaError, AppError } from '@/lib/utils/errors'

export const maxDuration = 10

export async function GET(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    const { taskId } = await context.params
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)
    if (!task) {
      return NextResponse.json({ error: 'Task not found', code: 'NOT_FOUND' }, { status: 404 })
    }
    const planRows = await db.select().from(plans).where(eq(plans.taskId, taskId)).orderBy(desc(plans.version))
    return NextResponse.json({ plans: planRows })
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error fetching plans:', error)
    return NextResponse.json({ error: 'Failed to fetch plans', code: 'INTERNAL' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    const { taskId } = await context.params
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, session.user.id), isNull(tasks.deletedAt)))
      .limit(1)
    if (!task) {
      return NextResponse.json({ error: 'Task not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'PLAN_SCHEMA_ERROR' }, { status: 400 })
    }

    const parsed = planSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          code: 'PLAN_SCHEMA_ERROR',
        },
        { status: 400 },
      )
    }

    const existing = await db.select().from(plans).where(eq(plans.taskId, taskId)).orderBy(desc(plans.version)).limit(1)
    const nextVersion = existing[0] ? existing[0].version + 1 : 1

    const [plan] = await db
      .insert(plans)
      .values({
        id: generateId(12),
        taskId,
        version: nextVersion,
        content: parsed.data as unknown as Record<string, unknown>,
        authoredBy: 'user',
      })
      .returning()

    return NextResponse.json({ plan }, { status: 201 })
  } catch (error) {
    if (error instanceof PlanSchemaError || error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('Error creating plan:', error)
    return NextResponse.json({ error: 'Failed to create plan', code: 'INTERNAL' }, { status: 500 })
  }
}
