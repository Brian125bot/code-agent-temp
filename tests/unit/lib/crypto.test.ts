import { describe, it, expect, beforeEach, vi } from 'vitest'
import { encrypt, decrypt } from '@/lib/crypto'

const VALID_KEY = 'a'.repeat(64) // 32 bytes in hex

describe('encrypt', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', VALID_KEY)
  })

  it('encrypts text and returns iv:ciphertext format', () => {
    const result = encrypt('hello world')
    expect(result).toMatch(/^[a-f0-9]+:[a-f0-9]+$/)
    expect(result).not.toBe('hello world')
  })

  it('returns empty string unchanged', () => {
    expect(encrypt('')).toBe('')
  })

  it('produces different ciphertext each time (random IV)', () => {
    const result1 = encrypt('hello')
    const result2 = encrypt('hello')
    expect(result1).not.toBe(result2)
  })

  it('throws when ENCRYPTION_KEY is missing', () => {
    vi.unstubAllEnvs()
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is required')
  })

  it('throws when ENCRYPTION_KEY is wrong length', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'abc123') // not 64 hex chars
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 32-byte hex string')
  })
})

describe('decrypt', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', VALID_KEY)
  })

  it('decrypts encrypted text correctly', () => {
    const original = 'hello world'
    const encrypted = encrypt(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('returns empty string unchanged', () => {
    expect(decrypt('')).toBe('')
  })

  it('throws when ENCRYPTION_KEY is missing', () => {
    vi.unstubAllEnvs()
    expect(() => decrypt('abc:def')).toThrow('ENCRYPTION_KEY environment variable is required')
  })

  it('throws for invalid format (no colon)', () => {
    expect(() => decrypt('invalidformat')).toThrow('Invalid encrypted text format')
  })

  it('throws for tampered ciphertext', () => {
    const encrypted = encrypt('hello')
    const [iv] = encrypted.split(':')
    expect(() => decrypt(`${iv}:0000000000000000`)).toThrow('Failed to decrypt')
  })

  it('throws when using wrong key', () => {
    const encrypted = encrypt('hello')
    vi.stubEnv('ENCRYPTION_KEY', 'b'.repeat(64))
    expect(() => decrypt(encrypted)).toThrow('Failed to decrypt')
  })

  it('roundtrip preserves special characters', () => {
    const originals = ['Hello, World! 🌍', 'line1\nline2\ttab', '{"key": "value"}', 'sk-ant-api03-test123', '']
    for (const original of originals) {
      if (!original) continue
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(original)
    }
  })
})
