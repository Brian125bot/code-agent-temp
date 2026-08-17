import { describe, it, expect } from 'vitest'
import { generateId } from '@/lib/utils/id'

describe('generateId', () => {
  it('generates ID of default length 12', () => {
    const id = generateId()
    expect(id).toHaveLength(12)
  })

  it('generates ID of specified length', () => {
    expect(generateId(20)).toHaveLength(20)
    expect(generateId(8)).toHaveLength(8)
    expect(generateId(32)).toHaveLength(32)
  })

  it('returns URL-safe characters only', () => {
    const id = generateId(100)
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })
})
