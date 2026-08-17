import { describe, it, expect } from 'vitest'
import { createFallbackTitle } from '@/lib/utils/title-generator'

describe('createFallbackTitle', () => {
  it('returns short prompt as-is', () => {
    expect(createFallbackTitle('Add feature')).toBe('Add feature')
  })

  it('returns prompt exactly 60 chars as-is', () => {
    const title = 'a'.repeat(60)
    expect(createFallbackTitle(title)).toBe(title)
  })

  it('truncates prompt longer than 60 chars with ...', () => {
    const title = 'a'.repeat(70)
    const result = createFallbackTitle(title)
    expect(result).toHaveLength(60)
    expect(result.endsWith('...')).toBe(true)
    expect(result).toBe('a'.repeat(57) + '...')
  })
})
