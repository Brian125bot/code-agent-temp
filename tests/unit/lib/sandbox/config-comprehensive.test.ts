import { describe, it, expect } from 'vitest'
import { createSandboxConfiguration } from '@/lib/sandbox/config'

describe('createSandboxConfiguration - comprehensive', () => {
  it('always uses node template', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test' })
    expect(result.template).toBe('node')
  })

  it('defaults branch to main', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test' })
    expect(result.git.branch).toBe('main')
  })

  it('uses provided branchName over default', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test', branchName: 'develop' })
    expect(result.git.branch).toBe('develop')
  })

  it('preserves repoUrl in git config', () => {
    const url = 'https://github.com/owner/repo.git'
    const result = createSandboxConfiguration({ repoUrl: url })
    expect(result.git.url).toBe(url)
  })

  it('defaults to port 3000', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test' })
    expect(result.ports).toEqual([3000])
  })

  it('defaults to node22 runtime', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test' })
    expect(result.runtime).toBe('node22')
  })

  it('defaults to 2 vcpus', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test' })
    expect(result.resources).toEqual({ vcpus: 2 })
  })

  it('defaults timeout to 20m', () => {
    const result = createSandboxConfiguration({ repoUrl: 'test' })
    expect(result.timeout).toBe('20m')
  })

  it('accepts all optional parameters', () => {
    const result = createSandboxConfiguration({
      repoUrl: 'https://github.com/test/repo',
      timeout: '45m',
      ports: [3000, 8080],
      runtime: 'node20',
      resources: { vcpus: 4 },
      branchName: 'feature/test',
    })
    expect(result).toEqual({
      template: 'node',
      git: { url: 'https://github.com/test/repo', branch: 'feature/test' },
      timeout: '45m',
      ports: [3000, 8080],
      runtime: 'node20',
      resources: { vcpus: 4 },
    })
  })
})
