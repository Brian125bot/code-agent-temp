import { vi } from 'vitest'
import type { Sandbox } from '@vercel/sandbox'

export function createMockSandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  return {
    runCommand: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: vi.fn().mockResolvedValue(''),
      stderr: vi.fn().mockResolvedValue(''),
    }),
    domain: 'test-sandbox.vercel.app',
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Sandbox
}

export function createMockSandboxResult(
  options: {
    exitCode?: number
    stdout?: string
    stderr?: string
  } = {},
) {
  return {
    exitCode: options.exitCode ?? 0,
    stdout: vi.fn().mockResolvedValue(options.stdout ?? ''),
    stderr: vi.fn().mockResolvedValue(options.stderr ?? ''),
  }
}
