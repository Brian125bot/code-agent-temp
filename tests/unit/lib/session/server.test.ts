import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SESSION_COOKIE_NAME } from '@/lib/session/constants'

// Use vi.hoisted to create the mock function before hoisting
const mockDecryptJWE = vi.hoisted(() => vi.fn())

vi.mock('@/lib/jwe/decrypt', () => ({
  decryptJWE: mockDecryptJWE,
}))

import { getSessionFromCookie, getSessionFromReq } from '@/lib/session/server'

describe('session constants', () => {
  it('SESSION_COOKIE_NAME is correct', () => {
    expect(SESSION_COOKIE_NAME).toBe('_user_session_')
  })
})

describe('getSessionFromCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined when cookieValue is undefined', async () => {
    mockDecryptJWE.mockResolvedValue(undefined)
    const result = await getSessionFromCookie(undefined)
    expect(result).toBeUndefined()
  })

  it('returns session when decryption succeeds', async () => {
    const mockSession = {
      created: Date.now(),
      authProvider: 'github' as const,
      user: { id: 'user_123', username: 'test', email: 'test@test.com', avatar: 'url' },
    }
    mockDecryptJWE.mockResolvedValue(mockSession)

    const result = await getSessionFromCookie('valid-jwe-token')
    expect(result).toEqual(mockSession)
  })

  it('returns undefined when decryption fails', async () => {
    mockDecryptJWE.mockResolvedValue(undefined)
    const result = await getSessionFromCookie('invalid-token')
    expect(result).toBeUndefined()
  })
})

describe('getSessionFromReq', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts session cookie from request', async () => {
    const mockSession = {
      created: Date.now(),
      authProvider: 'github' as const,
      user: { id: 'user_123', username: 'test', email: null, avatar: 'url' },
    }
    mockDecryptJWE.mockResolvedValue(mockSession)

    const mockReq = {
      cookies: {
        get: vi.fn().mockReturnValue({ value: 'session-token' }),
      },
    }

    const result = await getSessionFromReq(mockReq as never)
    expect(result).toEqual(mockSession)
    expect(mockReq.cookies.get).toHaveBeenCalledWith(SESSION_COOKIE_NAME)
  })

  it('returns undefined when no session cookie', async () => {
    mockDecryptJWE.mockResolvedValue(undefined)

    const mockReq = {
      cookies: {
        get: vi.fn().mockReturnValue(undefined),
      },
    }

    const result = await getSessionFromReq(mockReq as never)
    expect(result).toBeUndefined()
  })
})
