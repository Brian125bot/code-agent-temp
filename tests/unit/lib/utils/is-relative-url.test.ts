import { describe, it, expect } from 'vitest'
import { isRelativeUrl } from '@/lib/utils/is-relative-url'

describe('isRelativeUrl', () => {
  it('returns false for absolute HTTP URL', () => {
    expect(isRelativeUrl('http://example.com')).toBe(false)
  })

  it('returns false for absolute HTTPS URL', () => {
    expect(isRelativeUrl('https://example.com/path')).toBe(false)
  })

  it('returns false for FTP URL', () => {
    expect(isRelativeUrl('ftp://example.com/file')).toBe(false)
  })

  it('returns false for data URL', () => {
    expect(isRelativeUrl('data:text/html,<h1>test</h1>')).toBe(false)
  })

  it('returns true for relative path', () => {
    expect(isRelativeUrl('/relative/path')).toBe(true)
  })

  it('returns true for relative path without leading slash', () => {
    expect(isRelativeUrl('relative/path')).toBe(true)
  })

  it('returns true for empty string', () => {
    expect(isRelativeUrl('')).toBe(true)
  })

  it('returns true for hash-only URL', () => {
    expect(isRelativeUrl('#section')).toBe(true)
  })

  it('returns true for query-only URL', () => {
    expect(isRelativeUrl('?query=value')).toBe(true)
  })
})
