import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMockDb = () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
  }
  return chain
}

let mockDb = createMockDb()

vi.mock('@/lib/db/client', () => ({
  get db() {
    return mockDb
  },
}))

describe('settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockDb()
  })

  describe('getSetting', () => {
    it('returns default when no userId', async () => {
      const { getSetting } = await import('@/lib/db/settings')
      const result = await getSetting('maxMessagesPerDay', undefined, '10')
      expect(result).toBe('10')
    })

    it('returns user setting when found', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: '20' }])
      const { getSetting } = await import('@/lib/db/settings')
      const result = await getSetting('maxMessagesPerDay', 'user_123', '10')
      expect(result).toBe('20')
    })

    it('returns default when user setting not found', async () => {
      mockDb.limit.mockResolvedValueOnce([])
      const { getSetting } = await import('@/lib/db/settings')
      const result = await getSetting('maxMessagesPerDay', 'user_123', '10')
      expect(result).toBe('10')
    })
  })

  describe('getNumericSetting', () => {
    it('returns parsed number from user setting', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: '25' }])
      const { getNumericSetting } = await import('@/lib/db/settings')
      const result = await getNumericSetting('maxMessagesPerDay', 'user_123', 10)
      expect(result).toBe(25)
    })

    it('returns NaN for non-numeric value (parseInt behavior)', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: 'not-a-number' }])
      const { getNumericSetting } = await import('@/lib/db/settings')
      const result = await getNumericSetting('maxMessagesPerDay', 'user_123', 10)
      // parseInt('not-a-number') returns NaN, which is what getNumericSetting returns
      expect(Number.isNaN(result)).toBe(true)
    })
  })

  describe('getMaxMessagesPerDay', () => {
    it('returns user override when set', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: '50' }])
      const { getMaxMessagesPerDay } = await import('@/lib/db/settings')
      const result = await getMaxMessagesPerDay('user_123')
      expect(result).toBe(50)
    })

    it('returns default when no user setting', async () => {
      mockDb.limit.mockResolvedValueOnce([])
      const { getMaxMessagesPerDay } = await import('@/lib/db/settings')
      const result = await getMaxMessagesPerDay()
      expect(result).toBe(5) // Default from constants
    })
  })

  describe('getMaxSandboxDuration', () => {
    it('returns user override when set', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: '120' }])
      const { getMaxSandboxDuration } = await import('@/lib/db/settings')
      const result = await getMaxSandboxDuration('user_123')
      expect(result).toBe(120)
    })

    it('returns default when no user setting', async () => {
      mockDb.limit.mockResolvedValueOnce([])
      const { getMaxSandboxDuration } = await import('@/lib/db/settings')
      const result = await getMaxSandboxDuration()
      expect(result).toBe(60) // Default from constants
    })
  })
})
