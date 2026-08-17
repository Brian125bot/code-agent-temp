import { describe, it, expect } from 'vitest'
import { createSandboxConfiguration } from '@/lib/sandbox/config'

describe('createSandboxConfiguration', () => {
  it('sets correct defaults', () => {
    const result = createSandboxConfiguration({ repoUrl: 'https://github.com/test/repo' })
    expect(result).toEqual({
      template: 'node',
      git: { url: 'https://github.com/test/repo', branch: 'main' },
      timeout: '20m',
      ports: [3000],
      runtime: 'node22',
      resources: { vcpus: 2 },
    })
  })

  it('uses provided branch name', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/test/repo',
      branchName: 'feature/auth',
    })
    expect(result.git.branch).toBe('feature/auth')
  })

  it('uses provided timeout', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/test/repo',
      timeout: '45m',
    })
    expect(result.timeout).toBe('45m')
  })

  it('uses provided ports', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/test/repo',
      ports: [3000, 8080, 5173],
    })
    expect(result.ports).toEqual([3000, 8080, 5173])
  })

  it('uses provided runtime', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/test/repo',
      runtime: 'node20',
    })
    expect(result.runtime).toBe('node20')
  })

  it('uses provided resources', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/test/repo',
      resources: { vcpus: 8 },
    })
    expect(result.resources).toEqual({ vcpus: 8 })
  })
})
