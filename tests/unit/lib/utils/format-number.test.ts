import { describe, it, expect } from 'vitest'
import { formatAbbreviatedNumber } from '@/lib/utils/format-number'

describe('formatAbbreviatedNumber', () => {
  describe('numbers below 1000', () => {
    it('formats 0', () => {
      expect(formatAbbreviatedNumber(0)).toBe('0')
    })

    it('formats 1', () => {
      expect(formatAbbreviatedNumber(1)).toBe('1')
    })

    it('formats 500', () => {
      expect(formatAbbreviatedNumber(500)).toBe('500')
    })

    it('formats 999', () => {
      expect(formatAbbreviatedNumber(999)).toBe('999')
    })
  })

  describe('numbers in thousands range', () => {
    it('formats 1000 as "1k"', () => {
      expect(formatAbbreviatedNumber(1000)).toBe('1k')
    })

    it('formats 1100 as "1.1k"', () => {
      expect(formatAbbreviatedNumber(1100)).toBe('1.1k')
    })

    it('formats 1500 as "1.5k"', () => {
      expect(formatAbbreviatedNumber(1500)).toBe('1.5k')
    })

    it('formats 2000 as "2k"', () => {
      expect(formatAbbreviatedNumber(2000)).toBe('2k')
    })

    it('formats 999999 correctly', () => {
      // 999999 / 1000 = 999.999, toFixed(1) = "1000.0", endsWith(".0") -> floor(999999/1000) = 999
      expect(formatAbbreviatedNumber(999999)).toBe('999k')
    })
  })

  describe('numbers in millions range', () => {
    it('formats 1000000 as "1M"', () => {
      expect(formatAbbreviatedNumber(1000000)).toBe('1M')
    })

    it('formats 1500000 as "1.5M"', () => {
      expect(formatAbbreviatedNumber(1500000)).toBe('1.5M')
    })

    it('formats 2000000 as "2M"', () => {
      expect(formatAbbreviatedNumber(2000000)).toBe('2M')
    })

    it('formats 10000000 as "10M"', () => {
      expect(formatAbbreviatedNumber(10000000)).toBe('10M')
    })
  })

  describe('edge cases', () => {
    it('handles NaN', () => {
      expect(formatAbbreviatedNumber(NaN)).toBe('NaN')
    })

    it('handles Infinity', () => {
      // Infinity >= 1000000 is true, so it hits the M branch
      expect(formatAbbreviatedNumber(Infinity)).toBe('InfinityM')
    })

    it('handles negative numbers below 1000', () => {
      expect(formatAbbreviatedNumber(-500)).toBe('-500')
    })
  })
})
