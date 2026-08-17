import { describe, it, expect } from 'vitest'
import { createFallbackCommitMessage } from '@/lib/utils/commit-message-generator'

describe('createFallbackCommitMessage', () => {
  it('returns short description as-is', () => {
    expect(createFallbackCommitMessage('Fix bug')).toBe('Fix bug')
  })

  it('returns description exactly 72 chars as-is', () => {
    const msg = 'a'.repeat(72)
    expect(createFallbackCommitMessage(msg)).toBe(msg)
  })

  it('truncates description longer than 72 chars with ...', () => {
    const msg = 'a'.repeat(80)
    const result = createFallbackCommitMessage(msg)
    expect(result).toHaveLength(72)
    expect(result.endsWith('...')).toBe(true)
    expect(result).toBe('a'.repeat(69) + '...')
  })
})
