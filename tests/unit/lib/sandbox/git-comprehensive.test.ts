import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushChangesToBranch, shutdownSandbox } from '@/lib/sandbox/git'
import { createMockSandbox, createMockSandboxResult } from '../../../mocks/sandbox'

function createMockLogger(): any {
  return {
    info: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    command: vi.fn().mockResolvedValue(undefined),
    success: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
  }
}

describe('pushChangesToBranch - comprehensive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checks git status first', async () => {
    const runCommand = vi.fn().mockResolvedValue(createMockSandboxResult({ stdout: '' }))
    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    // git status returns empty, so no changes - only 1 call
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true })
  })

  it('skips commit when no changes', async () => {
    const runCommand = vi.fn().mockResolvedValue(createMockSandboxResult({ stdout: '' }))
    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: true })
    expect(runCommand).toHaveBeenCalledTimes(1) // Only git status
  })

  it('runs git add, commit, and push when changes exist', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult({ stdout: 'M file.ts' })) // status
      .mockResolvedValueOnce(createMockSandboxResult()) // add
      .mockResolvedValueOnce(createMockSandboxResult()) // commit
      .mockResolvedValueOnce(createMockSandboxResult()) // push

    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'feature/test', 'Add feature', logger)
    expect(result).toEqual({ success: true })
    expect(runCommand).toHaveBeenCalledTimes(4)

    // Check commit message was used
    const commitCall = runCommand.mock.calls[2]
    expect(commitCall[1][1]).toContain('Add feature')
  })

  it('handles permission error on push gracefully', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult({ stdout: 'M file.ts' })) // status
      .mockResolvedValueOnce(createMockSandboxResult()) // add
      .mockResolvedValueOnce(createMockSandboxResult()) // commit
      .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1, stderr: 'Permission denied 403' })) // push

    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: true, pushFailed: true })
  })

  it('handles network error during status check', async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error('Network error'))
    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: true }) // No changes detected, returns success
  })
})

describe('shutdownSandbox - comprehensive', () => {
  it('kills multiple process types', async () => {
    const runCommand = vi.fn().mockResolvedValue(createMockSandboxResult())
    const sandbox = createMockSandbox({ runCommand })

    await shutdownSandbox(sandbox)
    expect(runCommand).toHaveBeenCalledTimes(5) // node, python, npm, yarn, pnpm
  })

  it('handles pkill failure for one process type', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult()) // node
      .mockRejectedValueOnce(new Error('not found')) // python
      .mockResolvedValueOnce(createMockSandboxResult()) // npm
      .mockResolvedValueOnce(createMockSandboxResult()) // yarn
      .mockResolvedValueOnce(createMockSandboxResult()) // pnpm

    const sandbox = createMockSandbox({ runCommand })
    const result = await shutdownSandbox(sandbox)
    expect(result).toEqual({ success: true })
  })

  it('returns success with no sandbox', async () => {
    const result = await shutdownSandbox()
    expect(result).toEqual({ success: true })
  })
})
