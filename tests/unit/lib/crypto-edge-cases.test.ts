import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encrypt, decrypt } from '@/lib/crypto'

const VALID_KEY = 'a'.repeat(64) // 32 bytes in hex

describe('crypto - comprehensive edge cases', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', VALID_KEY)
  })

  describe('encrypt edge cases', () => {
    it('handles very long strings', () => {
      const longText = 'a'.repeat(10000)
      const encrypted = encrypt(longText)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(longText)
    })

    it('handles unicode characters', () => {
      const unicode = 'Hello 🌍 你好 مرحبا'
      const encrypted = encrypt(unicode)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(unicode)
    })

    it('handles empty string', () => {
      expect(encrypt('')).toBe('')
    })

    it('handles string with special characters', () => {
      const special = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      const encrypted = encrypt(special)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(special)
    })

    it('handles newlines and tabs', () => {
      const multiline = 'line1\nline2\ttab\rcarriage'
      const encrypted = encrypt(multiline)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(multiline)
    })

    it('output format is hex:hex', () => {
      const result = encrypt('test')
      const parts = result.split(':')
      expect(parts).toHaveLength(2)
      expect(parts[0]).toMatch(/^[a-f0-9]+$/)
      expect(parts[1]).toMatch(/^[a-f0-9]+$/)
    })

    it('IV is 16 bytes (32 hex chars)', () => {
      const result = encrypt('test')
      const [iv] = result.split(':')
      expect(iv).toHaveLength(32)
    })
  })

  describe('decrypt edge cases', () => {
    it('decrypts empty string', () => {
      expect(decrypt('')).toBe('')
    })

    it('throws for single hex string without colon', () => {
      expect(() => decrypt('abcdef1234567890')).toThrow('Invalid encrypted text format')
    })

    it('throws for malformed hex', () => {
      expect(() => decrypt('xyz:notvalid')).toThrow('Failed to decrypt')
    })

    it('throws for empty IV', () => {
      expect(() => decrypt(':notvalid')).toThrow()
    })

    it('throws for empty ciphertext', () => {
      const iv = 'a'.repeat(32)
      expect(() => decrypt(`${iv}:`)).toThrow('Failed to decrypt')
    })
  })

  describe('roundtrip integrity', () => {
    it('preserves various data types as strings', () => {
      const testCases = [
        'simple text',
        '{"json": "data"}',
        '<xml>content</xml>',
        'SELECT * FROM users',
        'https://example.com/path?q=1',
        'sk-ant-api03-test123',
        'ghp_testtoken1234567890',
      ]

      for (const text of testCases) {
        const encrypted = encrypt(text)
        const decrypted = decrypt(encrypted)
        expect(decrypted).toBe(text)
      }
    })

    it('produces different ciphertext for same input', () => {
      const results = Array.from({ length: 10 }, () => encrypt('same input'))
      const unique = new Set(results)
      expect(unique.size).toBe(10) // All should be different due to random IV
    })
  })
})
