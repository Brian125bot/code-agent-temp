import { describe, it, expect, vi } from 'vitest'
import { runCommandInSandbox, runInProject, runStreamingCommandInSandbox, PROJECT_DIR } from '@/lib/sandbox/commands'
import { createMockSandbox, createMockSandboxResult } from '../../../mocks/sandbox'

describe('runCommandInSandbox - comprehensive', () => {
  it('constructs full command string with args', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runCommandInSandbox(sandbox, 'git', ['status', '--porcelain'])
    expect(sandbox.runCommand).toHaveBeenCalledWith('git', ['status', '--porcelain'])
  })

  it('returns full command in result', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    const result = await runCommandInSandbox(sandbox, 'npm', ['install', '--save'])
    expect(result.command).toBe('npm install --save')
  })

  it('handles stderr output', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult({ exitCode: 1, stderr: 'warning: deprecated' })),
    })

    const result = await runCommandInSandbox(sandbox, 'npm', ['install'])
    expect(result.error).toBe('warning: deprecated')
  })

  it('handles non-Error exceptions', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockRejectedValue('string error'),
    })

    const result = await runCommandInSandbox(sandbox, 'ls')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Command execution failed')
  })
})

describe('runInProject - comprehensive', () => {
  it('escapes single quotes in args', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'echo', ["it's a test"])
    const callArgs = (sandbox.runCommand as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[1][1]).toContain("'\\''")
  })

  it('escapes multiple single quotes', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'echo', ["it's a 'test'"])
    const callArgs = (sandbox.runCommand as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[1][1]).toContain("'\\''")
  })

  it('handles args without single quotes', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'npm', ['install', '--save-dev'])
    const callArgs = (sandbox.runCommand as ReturnType<typeof vi.fn>).mock.calls[0]
    // Args are always wrapped in single quotes by escapeArg
    expect(callArgs[1][1]).toContain("npm 'install' '--save-dev'")
  })

  it('uses sh -c for command execution', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'ls')
    expect(sandbox.runCommand).toHaveBeenCalledWith('sh', expect.arrayContaining(['-c']))
  })
})

describe('runStreamingCommandInSandbox', () => {
  it('calls onJsonLine for valid JSON lines', async () => {
    const onJsonLine = vi.fn()
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue('{"key": "value"}\nnot json\n{"key2": "value2"}'),
        stderr: vi.fn().mockResolvedValue(''),
      }),
    })

    await runStreamingCommandInSandbox(sandbox, 'test', [], { onJsonLine })
    expect(onJsonLine).toHaveBeenCalledTimes(2)
    expect(onJsonLine).toHaveBeenCalledWith({ key: 'value' })
    expect(onJsonLine).toHaveBeenCalledWith({ key2: 'value2' })
  })

  it('calls onStdout with full output', async () => {
    const onStdout = vi.fn()
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue('test output'),
        stderr: vi.fn().mockResolvedValue(''),
      }),
    })

    await runStreamingCommandInSandbox(sandbox, 'test', [], { onStdout })
    expect(onStdout).toHaveBeenCalledWith('test output')
  })

  it('calls onStderr with error output', async () => {
    const onStderr = vi.fn()
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: vi.fn().mockResolvedValue(''),
        stderr: vi.fn().mockResolvedValue('error output'),
      }),
    })

    await runStreamingCommandInSandbox(sandbox, 'test', [], { onStderr })
    expect(onStderr).toHaveBeenCalledWith('error output')
  })

  it('handles command failure', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockRejectedValue(new Error('Command failed')),
    })

    const result = await runStreamingCommandInSandbox(sandbox, 'test')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Command failed')
  })
})

describe('PROJECT_DIR', () => {
  it('is an absolute path', () => {
    expect(PROJECT_DIR).toMatch(/^\//)
  })

  it('ends with project', () => {
    expect(PROJECT_DIR).toMatch(/\/project$/)
  })
})
