import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAppUrl } from '@/lib/utils/app-url'

describe('getAppUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns NEXT_PUBLIC_APP_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://myapp.com')
    expect(getAppUrl()).toBe('https://myapp.com')
  })

  it('returns https:// + VERCEL_URL when only VERCEL_URL is set', () => {
    vi.stubEnv('VERCEL_URL', 'myapp.vercel.app')
    expect(getAppUrl()).toBe('https://myapp.vercel.app')
  })

  it('returns localhost fallback when neither is set', () => {
    expect(getAppUrl()).toBe('http://localhost:3000')
  })

  it('NEXT_PUBLIC_APP_URL takes precedence over VERCEL_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://custom.com')
    vi.stubEnv('VERCEL_URL', 'vercel.app')
    expect(getAppUrl()).toBe('https://custom.com')
  })
})
