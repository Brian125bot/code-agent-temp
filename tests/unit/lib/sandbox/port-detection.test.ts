import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Octokit
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      getContent: vi.fn(),
    },
  })),
}))

describe('detectPortFromRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 3000 for non-GitHub URL', async () => {
    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://gitlab.com/owner/repo')
    expect(result).toBe(3000)
  })

  it('returns 3000 when package.json is not accessible', async () => {
    const { Octokit } = await import('@octokit/rest')
    const mockGetContent = vi.fn().mockRejectedValue(new Error('Not found'))
    vi.mocked(Octokit).mockImplementation(
      () =>
        ({
          repos: { getContent: mockGetContent },
        }) as never,
    )

    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://github.com/owner/repo')
    expect(result).toBe(3000)
  })

  it('returns 5173 when Vite is in dependencies', async () => {
    const { Octokit } = await import('@octokit/rest')
    const packageJson = JSON.stringify({ dependencies: { vite: '^5.0.0' } })
    const mockGetContent = vi.fn().mockResolvedValue({
      data: {
        content: Buffer.from(packageJson).toString('base64'),
        type: 'file',
      },
    })
    vi.mocked(Octokit).mockImplementation(
      () =>
        ({
          repos: { getContent: mockGetContent },
        }) as never,
    )

    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://github.com/owner/repo')
    expect(result).toBe(5173)
  })

  it('returns 5173 when Vite is in devDependencies', async () => {
    const { Octokit } = await import('@octokit/rest')
    const packageJson = JSON.stringify({ devDependencies: { vite: '^5.0.0' } })
    const mockGetContent = vi.fn().mockResolvedValue({
      data: {
        content: Buffer.from(packageJson).toString('base64'),
        type: 'file',
      },
    })
    vi.mocked(Octokit).mockImplementation(
      () =>
        ({
          repos: { getContent: mockGetContent },
        }) as never,
    )

    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://github.com/owner/repo')
    expect(result).toBe(5173)
  })

  it('returns 3000 when Vite is not in dependencies', async () => {
    const { Octokit } = await import('@octokit/rest')
    const packageJson = JSON.stringify({ dependencies: { next: '^14.0.0' } })
    const mockGetContent = vi.fn().mockResolvedValue({
      data: {
        content: Buffer.from(packageJson).toString('base64'),
        type: 'file',
      },
    })
    vi.mocked(Octokit).mockImplementation(
      () =>
        ({
          repos: { getContent: mockGetContent },
        }) as never,
    )

    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://github.com/owner/repo')
    expect(result).toBe(3000)
  })

  it('returns 3000 when package.json is a directory', async () => {
    const { Octokit } = await import('@octokit/rest')
    const mockGetContent = vi.fn().mockResolvedValue({
      data: { type: 'dir' },
    })
    vi.mocked(Octokit).mockImplementation(
      () =>
        ({
          repos: { getContent: mockGetContent },
        }) as never,
    )

    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://github.com/owner/repo')
    expect(result).toBe(3000)
  })

  it('returns 3000 for invalid JSON in package.json', async () => {
    const { Octokit } = await import('@octokit/rest')
    const mockGetContent = vi.fn().mockResolvedValue({
      data: {
        content: Buffer.from('not json').toString('base64'),
        type: 'file',
      },
    })
    vi.mocked(Octokit).mockImplementation(
      () =>
        ({
          repos: { getContent: mockGetContent },
        }) as never,
    )

    const { detectPortFromRepo } = await import('@/lib/sandbox/port-detection')
    const result = await detectPortFromRepo('https://github.com/owner/repo')
    expect(result).toBe(3000)
  })
})
