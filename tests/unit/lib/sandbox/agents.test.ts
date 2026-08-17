import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock only the gateway agent (statically imported)
const mockExecuteGateway = vi.fn().mockResolvedValue({ success: true, output: 'gateway done' })

vi.mock('@/lib/sandbox/agents/gateway', () => ({
  executeGatewayInSandbox: mockExecuteGateway,
}))
vi.mock('@/lib/sandbox/agents/claude', () => ({
  executeClaudeInSandbox: vi.fn().mockResolvedValue({ success: true, output: 'claude done' }),
}))
vi.mock('@/lib/sandbox/agents/codex', () => ({
  executeCodexInSandbox: vi.fn().mockResolvedValue({ success: true, output: 'codex done' }),
}))
vi.mock('@/lib/github/user-token', () => ({
  getUserGitHubToken: vi.fn().mockResolvedValue('ghp_test_token'),
}))

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

describe('executeAgentInSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('dispatches to gateway agent', async () => {
    const { executeAgentInSandbox } = await import('@/lib/sandbox/agents/index')
    const sandbox = {} as never
    const logger = createMockLogger()

    const result = await executeAgentInSandbox(sandbox, 'test prompt', 'gateway', logger)
    expect(result).toBeDefined()
    expect(result!.success).toBe(true)
    expect(mockExecuteGateway).toHaveBeenCalled()
  })

  it('returns error for legacy agent when ENABLE_LEGACY_AGENTS is not set', async () => {
    const { executeAgentInSandbox } = await import('@/lib/sandbox/agents/index')
    const sandbox = {} as never
    const logger = createMockLogger()

    const result = await executeAgentInSandbox(sandbox, 'test prompt', 'cursor', logger)
    expect(result).toBeDefined()
    expect(result!.success).toBe(false)
    expect(result!.error).toContain('cursor')
  })

  it('returns error for unknown agent type', async () => {
    const { executeAgentInSandbox } = await import('@/lib/sandbox/agents/index')
    const sandbox = {} as never
    const logger = createMockLogger()

    const result = await executeAgentInSandbox(sandbox, 'test prompt', 'unknown_agent' as never, logger)
    expect(result).toBeDefined()
    expect(result!.success).toBe(false)
    expect(result!.error).toContain('Unknown agent type')
  })

  it('checks cancellation before execution', async () => {
    const { executeAgentInSandbox } = await import('@/lib/sandbox/agents/index')
    const sandbox = {} as never
    const logger = createMockLogger()
    const onCancellationCheck = vi.fn().mockResolvedValue(true)

    const result = await executeAgentInSandbox(
      sandbox,
      'test prompt',
      'gateway',
      logger,
      undefined,
      undefined,
      onCancellationCheck,
    )
    expect(result).toBeDefined()
    expect(result!.success).toBe(false)
    expect(result!.error).toContain('cancelled')
  })

  it('passes parameters through to gateway agent', async () => {
    const { executeAgentInSandbox } = await import('@/lib/sandbox/agents/index')
    const sandbox = {} as never
    const logger = createMockLogger()

    await executeAgentInSandbox(sandbox, 'test prompt', 'gateway', logger, 'openai/gpt-5')
    expect(mockExecuteGateway).toHaveBeenCalledWith(sandbox, 'test prompt', logger, 'openai/gpt-5')
  })

  it('passes selectedModel parameter through', async () => {
    const { executeAgentInSandbox } = await import('@/lib/sandbox/agents/index')
    const sandbox = {} as never
    const logger = createMockLogger()

    // Just verify it doesn't throw with additional params
    const result = await executeAgentInSandbox(sandbox, 'test', 'gateway', logger, 'openai/gpt-5')
    expect(result).not.toBeNull()
  })
})
