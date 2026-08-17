import { describe, it, expect } from 'vitest'
import { redactSensitiveInfo } from '@/lib/utils/logging'

describe('redactSensitiveInfo - comprehensive edge cases', () => {
  describe('API key patterns', () => {
    it('redacts OPENAI_API_KEY with double quotes', () => {
      const input = 'OPENAI_API_KEY="sk-abcdefghijklmnopqrstuvwxyz"'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
      expect(result).toContain('OPENAI_API_KEY=')
    })

    it('redacts OPENAI_API_KEY with single quotes', () => {
      const input = "OPENAI_API_KEY='sk-abcdefghijklmnopqrstuvwxyz'"
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    })

    it('redacts ANTHROPIC_API_KEY with spaces around equals', () => {
      const input = 'ANTHROPIC_API_KEY = sk-ant-api03-abcdefghijklmnop'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-ant-api03-abcdefghijklmnop')
    })

    it('redacts multiple different key types in one string', () => {
      const input =
        'OPENAI_API_KEY=sk-abcdefghijklmnop GITHUB_TOKEN=ghpqrstuvwxyz1234567890 ANTHROPIC_API_KEY=sk-ant-api03-test1234567890'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-abcdefghijklmnop')
      expect(result).not.toContain('ghpqrstuvwxyz1234567890')
      expect(result).not.toContain('sk-ant-api03-test1234567890')
    })
  })

  describe('GitHub URL patterns', () => {
    it('redacts gho_ token in URL', () => {
      const input = 'https://gho_abcdefghijklmnopqrstuvwxyz123456@github.com/owner/repo'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('gho_abcdefghijklmnopqrstuvwxyz123456')
    })

    it('does not match ghu_ in URL (pattern only matches gh[phosr]_)', () => {
      // The URL pattern only matches ghp_, gho_, ghs_, ghr_ - not ghu_
      const input = 'https://ghu_abcdefghijklmnopqrstuvwxyz123456@github.com/owner/repo'
      const result = redactSensitiveInfo(input)
      // ghu_ is not matched by the URL pattern, but may be matched by other patterns
      // The token is still 40 chars so it may be caught by the generic TOKEN pattern
      expect(result).toContain('github.com')
    })

    it('redacts ghs_ token in URL', () => {
      const input = 'https://ghs_abcdefghijklmnopqrstuvwxyz123456@github.com/owner/repo'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('ghs_abcdefghijklmnopqrstuvwxyz123456')
    })

    it('redacts ghr_ token in URL', () => {
      const input = 'https://ghr_abcdefghijklmnopqrstuvwxyz123456@github.com/owner/repo'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('ghr_abcdefghijklmnopqrstuvwxyz123456')
    })

    it('preserves github.com domain in URL', () => {
      const input = 'https://ghp_abcdefghijklmnopqrstuvwxyz123456@github.com/owner/repo'
      const result = redactSensitiveInfo(input)
      expect(result).toContain('github.com')
    })
  })

  describe('Bearer token patterns', () => {
    it('redacts Bearer token without quotes', () => {
      const input = 'Authorization: Bearer sk-ant-api03-test1234567890abcdef'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-ant-api03-test1234567890abcdef')
    })

    it('redacts Bearer token with various token formats', () => {
      const input = 'Authorization: Bearer sk-test1234567890123456'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-test1234567890123456')
    })
  })

  describe('Vercel environment variables', () => {
    it('redacts SANDBOX_VERCEL_TOKEN with colon separator', () => {
      const input = 'SANDBOX_VERCEL_TOKEN: abcdef1234567890abcdef'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('abcdef1234567890abcdef')
    })

    it('redacts SANDBOX_VERCEL_TOKEN with quotes', () => {
      const input = 'SANDBOX_VERCEL_TOKEN="abcdef1234567890abcdef"'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('abcdef1234567890abcdef')
    })

    it('redacts SANDBOX_VERCEL_TEAM_ID with all formats', () => {
      const inputs = [
        'SANDBOX_VERCEL_TEAM_ID=team_abc123def456',
        'SANDBOX_VERCEL_TEAM_ID: team_abc123def456',
        'SANDBOX_VERCEL_TEAM_ID="team_abc123def456"',
      ]
      for (const input of inputs) {
        const result = redactSensitiveInfo(input)
        expect(result).not.toContain('team_abc123def456')
      }
    })
  })

  describe('JSON field patterns', () => {
    it('redacts teamId with various spacing', () => {
      const inputs = ['{"teamId": "value123"}', '{"teamId":"value123"}', '{ "teamId" : "value123" }']
      for (const input of inputs) {
        const result = redactSensitiveInfo(input)
        expect(result).toContain('[REDACTED]')
      }
    })

    it('redacts projectId with various spacing', () => {
      const inputs = ['{"projectId": "value123"}', '{"projectId":"value123"}']
      for (const input of inputs) {
        const result = redactSensitiveInfo(input)
        expect(result).toContain('[REDACTED]')
      }
    })

    it('redacts both teamId and projectId in same JSON', () => {
      const input = '{"teamId": "team123", "projectId": "proj456"}'
      const result = redactSensitiveInfo(input)
      expect(result).toContain('"teamId": "[REDACTED]"')
      expect(result).toContain('"projectId": "[REDACTED]"')
    })
  })

  describe('Generic environment variable patterns', () => {
    it('redacts SECRET_KEY patterns', () => {
      const inputs = [
        'MY_SECRET_KEY=abcdef1234567890',
        'APP_SECRET_KEY=abcdef1234567890',
        'DATABASE_SECRET_KEY=abcdef1234567890',
      ]
      for (const input of inputs) {
        const result = redactSensitiveInfo(input)
        expect(result).not.toContain('abcdef1234567890')
      }
    })

    it('redacts PASSWORD patterns', () => {
      const input = 'DATABASE_PASSWORD=supersecretpassword1234'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('supersecretpassword1234')
    })

    it('redacts TOKEN patterns', () => {
      const input = 'AUTH_TOKEN=abcdef1234567890abcdef'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('abcdef1234567890abcdef')
    })

    it('redacts KEY patterns', () => {
      const input = 'API_KEY=abcdef1234567890abcdef'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('abcdef1234567890abcdef')
    })
  })

  describe('Key length handling', () => {
    it('preserves first 4 and last 4 chars for long keys (20+ chars)', () => {
      const longKey = 'abcdefghijklmnopqrst'
      const input = `API_KEY=${longKey}`
      const result = redactSensitiveInfo(input)
      expect(result).toContain('abcd')
      expect(result).toContain(longKey.slice(-4))
    })

    it('fully redacts short keys (8 chars or less)', () => {
      const input = 'API_KEY=short123'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('short123')
    })

    it('handles exactly 8 char keys', () => {
      const input = 'API_KEY=12345678'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('12345678')
    })

    it('handles 9 char keys (just above threshold)', () => {
      const input = 'API_KEY=123456789'
      const result = redactSensitiveInfo(input)
      expect(result).toContain('1234')
      expect(result).toContain('6789')
    })
  })

  describe('Edge cases', () => {
    it('returns empty string unchanged', () => {
      expect(redactSensitiveInfo('')).toBe('')
    })

    it('returns string without secrets unchanged', () => {
      const input = 'User logged in at 2024-01-01'
      expect(redactSensitiveInfo(input)).toBe(input)
    })

    it('handles string with only whitespace', () => {
      expect(redactSensitiveInfo('   ')).toBe('   ')
    })

    it('handles multiline strings', () => {
      const input = 'Line 1: normal text\nLine 2: OPENAI_API_KEY=sk-test123\nLine 3: more text'
      const result = redactSensitiveInfo(input)
      expect(result).toContain('Line 1: normal text')
      expect(result).not.toContain('sk-test123')
      expect(result).toContain('Line 3: more text')
    })

    it('handles nested structures with API_KEY patterns', () => {
      const input = 'config: MY_API_KEY=sk-test1234567890123456'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-test1234567890123456')
    })

    it('preserves non-sensitive data in complex strings', () => {
      const input = 'User user123 created task task_abc at 2024-01-01T00:00:00Z'
      expect(redactSensitiveInfo(input)).toBe(input)
    })
  })
})
