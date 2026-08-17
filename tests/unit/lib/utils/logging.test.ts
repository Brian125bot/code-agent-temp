import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  redactSensitiveInfo,
  createLogEntry,
  createInfoLog,
  createCommandLog,
  createErrorLog,
  createSuccessLog,
} from '@/lib/utils/logging'

describe('redactSensitiveInfo', () => {
  describe('Anthropic API keys', () => {
    it('redacts ANTHROPIC_API_KEY with sk-ant- prefix', () => {
      const input = 'ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxx'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-ant-api03-xxxxxxxxxxxxxxxxxxxx')
      expect(result).toContain('ANTHROPIC_API_KEY=')
    })

    it('redacts ANTHROPIC_API_KEY in env var format with quotes', () => {
      const input = "ANTHROPIC_API_KEY='sk-ant-api03-abcdefghijklmnopqrstuvwxyz'"
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')
    })
  })

  describe('OpenAI API keys', () => {
    it('redacts OPENAI_API_KEY with sk- prefix', () => {
      const input = 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
      expect(result).toContain('OPENAI_API_KEY=')
    })
  })

  describe('GitHub tokens', () => {
    it('redacts GITHUB_TOKEN with ghp_ prefix', () => {
      const input = 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456')
      expect(result).toContain('GITHUB_TOKEN=')
    })

    it('redacts GITHUB_TOKEN with gho_ prefix', () => {
      const input = 'GITHUB_TOKEN=gho_abcdefghijklmnopqrstuvwxyz123456'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('gho_abcdefghijklmnopqrstuvwxyz123456')
    })

    it('redacts GitHub token in URL format', () => {
      const input = 'https://ghp_abcdefghijklmnopqrstuvwxyz123456@github.com'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456')
      expect(result).toContain('github.com')
    })
  })

  describe('Bearer tokens', () => {
    it('redacts Bearer tokens', () => {
      const input = 'Authorization: Bearer sk-ant-api03-xxxxxxxxxxxxxxxxxxxx'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-ant-api03-xxxxxxxxxxxxxxxxxxxx')
      expect(result).toContain('Bearer')
    })
  })

  describe('Vercel environment variables', () => {
    it('redacts SANDBOX_VERCEL_TOKEN', () => {
      const input = 'SANDBOX_VERCEL_TOKEN=abcdef1234567890abcdef'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('abcdef1234567890abcdef')
    })

    it('redacts SANDBOX_VERCEL_TEAM_ID', () => {
      const input = 'SANDBOX_VERCEL_TEAM_ID=team_abc123def456'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('team_abc123def456')
    })

    it('redacts SANDBOX_VERCEL_PROJECT_ID', () => {
      const input = 'SANDBOX_VERCEL_PROJECT_ID=prj_abc123def456ghi'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('prj_abc123def456ghi')
    })
  })

  describe('JSON field patterns', () => {
    it('redacts teamId in JSON', () => {
      const input = '{"teamId": "team_abc123def456"}'
      const result = redactSensitiveInfo(input)
      expect(result).toContain('"teamId": "[REDACTED]"')
      expect(result).not.toContain('team_abc123def456')
    })

    it('redacts projectId in JSON', () => {
      const input = '{"projectId": "prj_abc123def456ghi"}'
      const result = redactSensitiveInfo(input)
      expect(result).toContain('"projectId": "[REDACTED]"')
      expect(result).not.toContain('prj_abc123def456ghi')
    })
  })

  describe('Generic environment variable patterns', () => {
    it('redacts SECRET_KEY patterns', () => {
      const input = 'MY_SECRET_KEY=abcdef1234567890abcdef'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('abcdef1234567890abcdef')
      expect(result).toContain('MY_SECRET_KEY=')
    })

    it('redacts PASSWORD patterns', () => {
      const input = 'DB_PASSWORD=supersecretpassword1234'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('supersecretpassword1234')
    })
  })

  describe('Key length handling', () => {
    it('preserves first 4 and last 4 chars for long keys', () => {
      const longKey = 'sk-ant-api03-abcdefghijklmnop'
      const input = `OPENAI_API_KEY=${longKey}`
      const result = redactSensitiveInfo(input)
      expect(result).toContain('sk-a')
      expect(result).toContain(longKey.slice(-4))
    })

    it('fully redacts short keys (8 chars or less)', () => {
      const input = 'API_KEY=short123'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('short123')
    })
  })

  describe('Edge cases', () => {
    it('returns empty string unchanged', () => {
      expect(redactSensitiveInfo('')).toBe('')
    })

    it('returns string without secrets unchanged', () => {
      const input = 'This is a normal log message with no secrets'
      expect(redactSensitiveInfo(input)).toBe(input)
    })

    it('handles multiple secrets in one string', () => {
      const input = 'OPENAI_API_KEY=sk-abcdefghijklmnop GITHUB_TOKEN=ghp_qrstuvwxyz123456'
      const result = redactSensitiveInfo(input)
      expect(result).not.toContain('sk-abcdefghijklmnop')
      expect(result).not.toContain('ghp_qrstuvwxyz123456')
    })

    it('handles string with no matching patterns', () => {
      const input = 'User logged in successfully'
      expect(redactSensitiveInfo(input)).toBe(input)
    })
  })
})

describe('createLogEntry', () => {
  it('creates a log entry with correct type', () => {
    const entry = createLogEntry('info', 'Test message')
    expect(entry.type).toBe('info')
    expect(entry.message).toBe('Test message')
    expect(entry.timestamp).toBeInstanceOf(Date)
  })

  it('applies redaction to message', () => {
    const entry = createLogEntry('info', 'OPENAI_API_KEY=sk-abcdefghijklmnop')
    expect(entry.message).not.toContain('sk-abcdefghijklmnop')
  })

  it('uses provided timestamp', () => {
    const timestamp = new Date('2024-06-15')
    const entry = createLogEntry('info', 'Test', timestamp)
    expect(entry.timestamp).toBe(timestamp)
  })
})

describe('createInfoLog', () => {
  it('creates info log entry', () => {
    const entry = createInfoLog('Test message')
    expect(entry.type).toBe('info')
    expect(entry.message).toBe('Test message')
  })
})

describe('createCommandLog', () => {
  it('creates command log with $ prefix', () => {
    const entry = createCommandLog('npm', ['install'])
    expect(entry.type).toBe('command')
    expect(entry.message).toBe('$ npm install')
  })

  it('creates command log without args', () => {
    const entry = createCommandLog('git status')
    expect(entry.message).toBe('$ git status')
  })
})

describe('createErrorLog', () => {
  it('creates error log entry', () => {
    const entry = createErrorLog('Build failed')
    expect(entry.type).toBe('error')
    expect(entry.message).toBe('Build failed')
  })
})

describe('createSuccessLog', () => {
  it('creates success log entry', () => {
    const entry = createSuccessLog('Task completed')
    expect(entry.type).toBe('success')
    expect(entry.message).toBe('Task completed')
  })
})
