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

describe('pushChangesToBranch', () => {
  it('returns success when no changes detected', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult({ stdout: '' })),
    })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test commit', logger)
    expect(result).toEqual({ success: true })
  })

  it('commits and pushes when changes detected', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult({ stdout: 'M file.ts' })) // git status
      .mockResolvedValueOnce(createMockSandboxResult()) // git add
      .mockResolvedValueOnce(createMockSandboxResult()) // git commit
      .mockResolvedValueOnce(createMockSandboxResult()) // git push

    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'feature/test', 'Add feature', logger)
    expect(result).toEqual({ success: true })
    expect(runCommand).toHaveBeenCalledTimes(4)
  })

  it('returns failure when git add fails', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult({ stdout: 'M file.ts' })) // git status
      .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1, stderr: 'permission denied' })) // git add fails

    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: false })
  })

  it('returns failure when git commit fails', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult({ stdout: 'M file.ts' })) // git status
      .mockResolvedValueOnce(createMockSandboxResult()) // git add
      .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1, stderr: 'nothing to commit' })) // git commit fails

    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: false })
  })

  it('returns success with pushFailed when push fails', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce(createMockSandboxResult({ stdout: 'M file.ts' })) // git status
      .mockResolvedValueOnce(createMockSandboxResult()) // git add
      .mockResolvedValueOnce(createMockSandboxResult()) // git commit
      .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1, stderr: 'Permission denied' })) // push fails

    const sandbox = createMockSandbox({ runCommand })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: true, pushFailed: true })
  })

  it('returns success when git status command fails (no changes)', async () => {
    // When runCommand throws, runCommandInSandbox catches it and returns { success: false }
    // pushChangesToBranch then checks output?.trim() which is empty, so returns success
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockRejectedValue(new Error('Network error')),
    })
    const logger = createMockLogger()

    const result = await pushChangesToBranch(sandbox, 'main', 'test', logger)
    expect(result).toEqual({ success: true })
  })
})

describe('shutdownSandbox', () => {
  it('returns success when no sandbox provided', async () => {
    const result = await shutdownSandbox()
    expect(result).toEqual({ success: true })
  })

  it('attempts to kill processes when sandbox provided', async () => {
    const runCommand = vi.fn().mockResolvedValue(createMockSandboxResult())
    const sandbox = createMockSandbox({ runCommand })

    const result = await shutdownSandbox(sandbox)
    expect(result).toEqual({ success: true })
    expect(runCommand).toHaveBeenCalled()
  })

  it('handles process kill failure gracefully', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockRejectedValue(new Error('Process not found')),
    })

    const result = await shutdownSandbox(sandbox)
    expect(result).toEqual({ success: true })
  })
})
