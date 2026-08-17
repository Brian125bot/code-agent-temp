import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { sql } from 'drizzle-orm'

export const maxDuration = 10

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`)
    return NextResponse.json({ status: 'ok', db: 'reachable' })
  } catch (e) {
    return NextResponse.json({ status: 'error', db: 'unreachable' }, { status: 503 })
  }
}
