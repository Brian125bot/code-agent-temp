import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectPackageManager, getDevCommandArgs } from '@/lib/sandbox/package-manager'
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

describe('detectPackageManager', () => {
  it('detects pnpm from pnpm-lock.yaml', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValueOnce(createMockSandboxResult({ exitCode: 0 })),
    })
    const logger = createMockLogger()

    const result = await detectPackageManager(sandbox, logger)
    expect(result).toBe('pnpm')
  })

  it('detects yarn from yarn.lock', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi
        .fn()
        .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1 })) // pnpm not found
        .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 0 })), // yarn found
    })
    const logger = createMockLogger()

    const result = await detectPackageManager(sandbox, logger)
    expect(result).toBe('yarn')
  })

  it('detects npm from package-lock.json', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi
        .fn()
        .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1 })) // pnpm
        .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 1 })) // yarn
        .mockResolvedValueOnce(createMockSandboxResult({ exitCode: 0 })), // npm
    })
    const logger = createMockLogger()

    const result = await detectPackageManager(sandbox, logger)
    expect(result).toBe('npm')
  })

  it('defaults to npm when no lock files found', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult({ exitCode: 1 })),
    })
    const logger = createMockLogger()

    const result = await detectPackageManager(sandbox, logger)
    expect(result).toBe('npm')
  })
})

describe('getDevCommandArgs', () => {
  it('returns ["run", "dev"] for npm', async () => {
    const sandbox = createMockSandbox()
    const result = await getDevCommandArgs(sandbox, 'npm')
    expect(result).toEqual(['run', 'dev'])
  })

  it('returns ["dev"] for pnpm', async () => {
    const sandbox = createMockSandbox()
    const result = await getDevCommandArgs(sandbox, 'pnpm')
    expect(result).toEqual(['dev'])
  })

  it('returns ["dev"] for yarn', async () => {
    const sandbox = createMockSandbox()
    const result = await getDevCommandArgs(sandbox, 'yarn')
    expect(result).toEqual(['dev'])
  })
})
