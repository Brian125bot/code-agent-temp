import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEnabledAuthProviders } from '@/lib/auth/providers'

describe('getEnabledAuthProviders', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to github when env var is unset', () => {
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: true, vercel: false })
  })

  it('enables github only when env is "github"', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'github')
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: true, vercel: false })
  })

  it('enables both when env is "github,vercel"', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'github,vercel')
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: true, vercel: true })
  })

  it('enables both when env is "vercel,github"', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'vercel,github')
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: true, vercel: true })
  })

  it('is case-insensitive', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'GitHub')
    const result = getEnabledAuthProviders()
    expect(result.github).toBe(true)
  })

  it('handles whitespace around providers', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', ' github , vercel ')
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: true, vercel: true })
  })

  it('defaults to github for empty string (falsy value)', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', '')
    const result = getEnabledAuthProviders()
    // Empty string is falsy, so defaults to 'github'
    expect(result).toEqual({ github: true, vercel: false })
  })

  it('ignores unknown providers', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'saml,oidc')
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: false, vercel: false })
  })

  it('enables only vercel when env is "vercel"', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'vercel')
    const result = getEnabledAuthProviders()
    expect(result).toEqual({ github: false, vercel: true })
  })
})
