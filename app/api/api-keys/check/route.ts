import { NextRequest, NextResponse } from 'next/server'
import { getUserApiKey } from '@/lib/api-keys/user-keys'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const agent = searchParams.get('agent')
    if (!agent) return NextResponse.json({ error: 'Agent parameter is required' }, { status: 400 })

    if (agent === 'copilot') {
      const { getUserGitHubToken } = await import('@/lib/github/user-token')
      const githubToken = await getUserGitHubToken()
      return NextResponse.json({ success: true, hasKey: !!githubToken, provider: 'github', agentName: 'Copilot' })
    }

    const apiKey = await getUserApiKey('aigateway')
    return NextResponse.json({
      success: true,
      hasKey: !!apiKey,
      provider: 'aigateway',
      agentName: agent.charAt(0).toUpperCase() + agent.slice(1),
    })
  } catch (error) {
    console.error('Error checking API key:', error)
    return NextResponse.json({ error: 'Failed to check API key' }, { status: 500 })
  }
}
