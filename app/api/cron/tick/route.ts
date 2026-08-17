import { NextRequest, NextResponse } from 'next/server'
import { GET as runReap } from '@/app/api/cron/reap/route'
import { GET as runAudio } from '@/app/api/cron/audio/route'
import { GET as runMetrics } from '@/app/api/cron/metrics/route'

export const maxDuration = 10

function isCronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const auth = req.headers.get('authorization') || ''
  const token = process.env.CRON_SECRET || process.env.SANDBOX_VERCEL_TOKEN
  if (token && auth === `Bearer ${token}`) return true
  if (process.env.NODE_ENV !== 'production') return true
  return false
}

function createCronRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { 'x-vercel-cron': '1' },
  })
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}

  try {
    const reapRes = await runReap(createCronRequest('/api/cron/reap'))
    results.reap = await reapRes.json()
  } catch (error) {
    console.error('Cron tick reap failed:', error)
    results.reap = { error: 'failed' }
  }

  try {
    const audioRes = await runAudio(createCronRequest('/api/cron/audio'))
    results.audio = await audioRes.json()
  } catch (error) {
    console.error('Cron tick audio failed:', error)
    results.audio = { error: 'failed' }
  }

  try {
    const metricsRes = await runMetrics(createCronRequest('/api/cron/metrics'))
    results.metrics = await metricsRes.json()
  } catch (error) {
    console.error('Cron tick metrics failed:', error)
    results.metrics = { error: 'failed' }
  }

  return NextResponse.json({ ok: true, results })
}
