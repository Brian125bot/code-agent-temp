import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCommandInSandbox, runInProject, PROJECT_DIR } from '@/lib/sandbox/commands'
import { createMockSandbox, createMockSandboxResult } from '../../../mocks/sandbox'

describe('runCommandInSandbox', () => {
  it('returns success when command exits with code 0', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult({ exitCode: 0, stdout: 'output' })),
    })

    const result = await runCommandInSandbox(sandbox, 'ls', ['-la'])
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('output')
    expect(result.command).toBe('ls -la')
  })

  it('returns failure when command exits with non-zero code', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult({ exitCode: 1, stderr: 'error occurred' })),
    })

    const result = await runCommandInSandbox(sandbox, 'failing-command')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.error).toBe('error occurred')
  })

  it('handles command execution exception', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockRejectedValue(new Error('Connection failed')),
    })

    const result = await runCommandInSandbox(sandbox, 'ls')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Connection failed')
  })

  it('handles command with no args', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    const result = await runCommandInSandbox(sandbox, 'pwd')
    expect(result.command).toBe('pwd')
  })

  it('handles stdout read failure gracefully', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: vi.fn().mockRejectedValue(new Error('read error')),
        stderr: vi.fn().mockResolvedValue(''),
      }),
    })

    const result = await runCommandInSandbox(sandbox, 'ls')
    expect(result.success).toBe(true)
    expect(result.output).toBe('')
  })
})

describe('runInProject', () => {
  it('wraps command with cd to PROJECT_DIR', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'npm', ['install'])
    expect(sandbox.runCommand).toHaveBeenCalledWith('sh', ['-c', `cd ${PROJECT_DIR} && npm 'install'`])
  })

  it('escapes single quotes in arguments', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'echo', ["it's a test"])
    const callArgs = (sandbox.runCommand as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[1][1]).toContain("'\\''")
  })

  it('wraps command without args', async () => {
    const sandbox = createMockSandbox({
      runCommand: vi.fn().mockResolvedValue(createMockSandboxResult()),
    })

    await runInProject(sandbox, 'git status')
    const callArgs = (sandbox.runCommand as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs[1][1]).toContain(`cd ${PROJECT_DIR} && git status`)
  })
})

describe('PROJECT_DIR', () => {
  it('is set to /vercel/sandbox/project', () => {
    expect(PROJECT_DIR).toBe('/vercel/sandbox/project')
  })
})
