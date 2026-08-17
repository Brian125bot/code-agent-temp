import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateEnvironmentVariables,
  createAuthenticatedRepoUrl,
  createSandboxConfiguration,
} from '@/lib/sandbox/config'

describe('validateEnvironmentVariables', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  describe('gateway agent', () => {
    it('returns valid when all required vars are present', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      const result = validateEnvironmentVariables('github_token_123', 'github_token_123', {
        AI_GATEWAY_API_KEY: 'gw_key_123',
      })
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns error when AI_GATEWAY_API_KEY is missing for gateway', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      const result = validateEnvironmentVariables('gateway', 'github_token')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('AI_GATEWAY_API_KEY is required')
    })
  })

  describe('claude/codex agents', () => {
    it('returns error when AI_GATEWAY_API_KEY is missing for claude', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      const result = validateEnvironmentVariables('claude', 'github_token')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('AI_GATEWAY_API_KEY is required for claude')
    })

    it('returns error when AI_GATEWAY_API_KEY is missing for codex', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      const result = validateEnvironmentVariables('codex', 'github_token')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('AI_GATEWAY_API_KEY is required for codex')
    })
  })

  describe('legacy agents', () => {
    it('returns error for unknown agent without legacy flag', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      const result = validateEnvironmentVariables('cursor', 'github_token')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unknown agent cursor')
    })

    it('returns error for legacy agent requiring specific key', () => {
      vi.stubEnv('ENABLE_LEGACY_AGENTS', 'true')
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      const result = validateEnvironmentVariables('cursor', 'github_token')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('CURSOR_API_KEY is required')
    })
  })

  describe('GitHub token', () => {
    it('returns error when github token is missing', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_key')
      const result = validateEnvironmentVariables('gateway', null, { AI_GATEWAY_API_KEY: 'gw_key' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('GitHub is required')
    })
  })

  describe('sandbox infrastructure vars', () => {
    it('returns error when SANDBOX_VERCEL_TEAM_ID is missing', () => {
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_key')
      const result = validateEnvironmentVariables('gateway', 'gh_token', { AI_GATEWAY_API_KEY: 'gw_key' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('SANDBOX_VERCEL_TEAM_ID is required')
    })

    it('returns error when SANDBOX_VERCEL_PROJECT_ID is missing', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_TOKEN', 'token_abc')
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_key')
      const result = validateEnvironmentVariables('gateway', 'gh_token', { AI_GATEWAY_API_KEY: 'gw_key' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('SANDBOX_VERCEL_PROJECT_ID is required')
    })

    it('returns error when SANDBOX_VERCEL_TOKEN is missing', () => {
      vi.stubEnv('SANDBOX_VERCEL_TEAM_ID', 'team_abc')
      vi.stubEnv('SANDBOX_VERCEL_PROJECT_ID', 'prj_abc')
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_key')
      const result = validateEnvironmentVariables('gateway', 'gh_token', { AI_GATEWAY_API_KEY: 'gw_key' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('SANDBOX_VERCEL_TOKEN is required')
    })

    it('collects multiple errors', () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', 'gw_key')
      const result = validateEnvironmentVariables('gateway', 'gh_token', { AI_GATEWAY_API_KEY: 'gw_key' })
      expect(result.valid).toBe(false)
      const errors = result.error!.split(', ')
      expect(errors.length).toBeGreaterThan(1)
    })
  })
})

describe('createAuthenticatedRepoUrl', () => {
  it('injects token into github.com URL', () => {
    const result = createAuthenticatedRepoUrl('https://github.com/owner/repo.git', 'ghp_token123')
    expect(result).toContain('ghp_token123')
    expect(result).toContain('x-oauth-basic')
    expect(result).toContain('github.com')
  })

  it('does not inject token for non-github URLs', () => {
    const result = createAuthenticatedRepoUrl('https://gitlab.com/owner/repo.git', 'token123')
    expect(result).not.toContain('token123')
    expect(result).toBe('https://gitlab.com/owner/repo.git')
  })

  it('returns original URL when no token provided', () => {
    const url = 'https://github.com/owner/repo.git'
    expect(createAuthenticatedRepoUrl(url, null)).toBe(url)
    expect(createAuthenticatedRepoUrl(url, undefined)).toBe(url)
  })

  it('returns original URL for invalid URL format', () => {
    const result = createAuthenticatedRepoUrl('not-a-url', 'token')
    expect(result).toBe('not-a-url')
  })
})

describe('createSandboxConfiguration', () => {
  it('applies defaults for missing config', () => {
    const result = createSandboxConfiguration({ repoUrl: 'https://github.com/owner/repo.git' })
    expect(result.template).toBe('node')
    expect(result.git.branch).toBe('main')
    expect(result.timeout).toBe('20m')
    expect(result.ports).toEqual([3000])
    expect(result.runtime).toBe('node22')
    expect(result.resources).toEqual({ vcpus: 2 })
  })

  it('uses provided config values', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/owner/repo.git',
      timeout: '30m',
      ports: [3000, 8080],
      runtime: 'node20',
      resources: { vcpus: 4 },
      branchName: 'feature/test',
    })
    expect(result.git.branch).toBe('feature/test')
    expect(result.timeout).toBe('30m')
    expect(result.ports).toEqual([3000, 8080])
    expect(result.runtime).toBe('node20')
    expect(result.resources).toEqual({ vcpus: 4 })
  })
})
