import { describe, it, expect, vi } from 'vitest'
import { parseGitHubUrl } from '@/lib/github/client'

// We only test parseGitHubUrl since the other functions require Octokit mocking
describe('parseGitHubUrl', () => {
  it('parses HTTPS GitHub URL', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('parses HTTPS URL with .git suffix', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo.git')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('parses SSH GitHub URL', () => {
    const result = parseGitHubUrl('git@github.com:owner/repo.git')
    expect(result).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('parses URL with hyphens in owner/repo', () => {
    const result = parseGitHubUrl('https://github.com/my-org/my-repo')
    expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' })
  })

  it('parses URL with underscores in owner/repo', () => {
    const result = parseGitHubUrl('https://github.com/my_org/my_repo')
    expect(result).toEqual({ owner: 'my_org', repo: 'my_repo' })
  })

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull()
  })

  it('returns null for invalid URL', () => {
    expect(parseGitHubUrl('not-a-url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseGitHubUrl('')).toBeNull()
  })

  it('handles URL with trailing slash', () => {
    const result = parseGitHubUrl('https://github.com/owner/repo/')
    // The regex may or may not match trailing slash depending on implementation
    // The actual regex is: /github\.com[/:]([\w-]+)\/([\w-]+?)(\.git)?$/
    // Trailing slash won't match because $ requires end of string
    expect(result).toBeNull()
  })
})
