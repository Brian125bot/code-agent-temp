import { GATEWAY_BASE_URL } from '@/lib/constants'

export function validateEnvironmentVariables(
  selectedAgent: string = 'gateway',
  githubToken?: string | null,
  apiKeys?: {
    AI_GATEWAY_API_KEY?: string
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
  },
) {
  const errors: string[] = []
  const hasGatewayKey = Boolean(apiKeys?.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_API_KEY)

  if (!hasGatewayKey) {
    if (selectedAgent === 'gateway') {
      errors.push('AI_GATEWAY_API_KEY is required. Add it in your profile (Vercel AI Gateway).')
    } else if (['claude', 'codex'].includes(selectedAgent)) {
      errors.push(`AI_GATEWAY_API_KEY is required for ${selectedAgent}. Routed via ${GATEWAY_BASE_URL}.`)
    } else if (process.env.ENABLE_LEGACY_AGENTS) {
      const legacyMap: Record<string, string> = {
        cursor: 'CURSOR_API_KEY',
        gemini: 'GEMINI_API_KEY',
        opencode: 'AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY',
        copilot: 'GitHub token (GH_TOKEN)',
      }
      const need = legacyMap[selectedAgent]
      if (need) errors.push(`${need} is required for legacy agent ${selectedAgent}.`)
    } else {
      errors.push(`Unknown agent ${selectedAgent}. Use gateway, claude, or codex (all via AI Gateway).`)
    }
  }

  if (!githubToken) {
    errors.push('GitHub is required for repository access. Please connect your GitHub account.')
  }

  if (!process.env.SANDBOX_VERCEL_TEAM_ID) {
    errors.push('SANDBOX_VERCEL_TEAM_ID is required for sandbox creation')
  }
  if (!process.env.SANDBOX_VERCEL_PROJECT_ID) {
    errors.push('SANDBOX_VERCEL_PROJECT_ID is required for sandbox creation')
  }
  if (!process.env.SANDBOX_VERCEL_TOKEN) {
    errors.push('SANDBOX_VERCEL_TOKEN is required for sandbox creation')
  }

  return { valid: errors.length === 0, error: errors.length > 0 ? errors.join(', ') : undefined }
}

export function createAuthenticatedRepoUrl(repoUrl: string, githubToken?: string | null): string {
  if (!githubToken) return repoUrl
  try {
    const url = new URL(repoUrl)
    if (url.hostname === 'github.com') {
      url.username = githubToken
      url.password = 'x-oauth-basic'
    }
    return url.toString()
  } catch {
    return repoUrl
  }
}

export function createSandboxConfiguration(config: {
  repoUrl: string
  timeout?: string
  ports?: number[]
  runtime?: string
  resources?: { vcpus?: number }
  branchName?: string
}) {
  return {
    template: 'node',
    git: { url: config.repoUrl, branch: config.branchName || 'main' },
    timeout: config.timeout || '20m',
    ports: config.ports || [3000],
    runtime: config.runtime || 'node22',
    resources: config.resources || { vcpus: 2 },
  }
}
