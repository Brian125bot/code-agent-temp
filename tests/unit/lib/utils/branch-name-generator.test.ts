import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFallbackBranchName } from '@/lib/utils/branch-name-generator'

describe('createFallbackBranchName', () => {
  it('creates branch name with agent/ prefix', () => {
    const result = createFallbackBranchName('task123')
    expect(result).toMatch(/^agent\//)
  })

  it('includes first 8 chars of taskId', () => {
    const result = createFallbackBranchName('abcdefghij')
    expect(result).toContain('abcdefgh')
  })

  it('truncates taskId to 8 chars', () => {
    const result = createFallbackBranchName('verylongtaskid12345')
    expect(result).toContain('verylong')
    expect(result).not.toContain('verylongt')
  })

  it('includes timestamp in the branch name', () => {
    const result = createFallbackBranchName('test')
    // Format: agent/{timestamp}-{taskId}
    expect(result).toMatch(/^agent\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-test$/)
  })
})

describe('generateBranchName', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when AI_GATEWAY_API_KEY is missing', async () => {
    const { generateBranchName } = await import('@/lib/utils/branch-name-generator')
    await expect(generateBranchName({ description: 'Add feature' })).rejects.toThrow(
      'AI_GATEWAY_API_KEY environment variable is required',
    )
  })
})
