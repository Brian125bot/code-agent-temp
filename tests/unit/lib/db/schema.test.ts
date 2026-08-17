import { describe, it, expect } from 'vitest'
import { insertTaskSchema, insertUserSchema, logEntrySchema } from '@/lib/db/schema'

describe('logEntrySchema', () => {
  it('validates correct log entry', () => {
    const result = logEntrySchema.safeParse({
      type: 'info',
      message: 'Test message',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid type', () => {
    const result = logEntrySchema.safeParse({
      type: 'invalid',
      message: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('allows optional timestamp', () => {
    const result = logEntrySchema.safeParse({
      type: 'error',
      message: 'Error occurred',
      timestamp: new Date(),
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid types', () => {
    for (const type of ['info', 'command', 'error', 'success']) {
      const result = logEntrySchema.safeParse({ type, message: 'test' })
      expect(result.success).toBe(true)
    }
  })
})

describe('insertTaskSchema', () => {
  it('validates minimal required fields', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
      prompt: 'Add authentication',
    })
    expect(result.success).toBe(true)
  })

  it('requires userId', () => {
    const result = insertTaskSchema.safeParse({
      prompt: 'Add authentication',
    })
    expect(result.success).toBe(false)
  })

  it('requires prompt', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty prompt', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
      prompt: '',
    })
    expect(result.success).toBe(false)
  })

  it('validates with all optional fields', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
      prompt: 'Add authentication',
      title: 'Auth Feature',
      repoUrl: 'https://github.com/owner/repo',
      selectedAgent: 'gateway',
      status: 'pending',
      progress: 50,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
      prompt: 'test',
      status: 'invalid_status',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid agent', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
      prompt: 'test',
      selectedAgent: 'invalid_agent',
    })
    expect(result.success).toBe(false)
  })

  it('rejects progress outside 0-100 range', () => {
    const result = insertTaskSchema.safeParse({
      userId: 'user_123',
      prompt: 'test',
      progress: 150,
    })
    expect(result.success).toBe(false)
  })
})

describe('insertUserSchema', () => {
  it('validates minimal required fields', () => {
    const result = insertUserSchema.safeParse({
      provider: 'github',
      externalId: '12345',
      accessToken: 'token',
      username: 'testuser',
    })
    expect(result.success).toBe(true)
  })

  it('requires provider', () => {
    const result = insertUserSchema.safeParse({
      externalId: '12345',
      accessToken: 'token',
      username: 'testuser',
    })
    expect(result.success).toBe(false)
  })

  it('requires externalId', () => {
    const result = insertUserSchema.safeParse({
      provider: 'github',
      accessToken: 'token',
      username: 'testuser',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty externalId', () => {
    const result = insertUserSchema.safeParse({
      provider: 'github',
      externalId: '',
      accessToken: 'token',
      username: 'testuser',
    })
    expect(result.success).toBe(false)
  })

  it('requires username', () => {
    const result = insertUserSchema.safeParse({
      provider: 'github',
      externalId: '12345',
      accessToken: 'token',
    })
    expect(result.success).toBe(false)
  })

  it('accepts both provider values', () => {
    for (const provider of ['github', 'vercel']) {
      const result = insertUserSchema.safeParse({
        provider,
        externalId: '12345',
        accessToken: 'token',
        username: 'testuser',
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid provider', () => {
    const result = insertUserSchema.safeParse({
      provider: 'google',
      externalId: '12345',
      accessToken: 'token',
      username: 'testuser',
    })
    expect(result.success).toBe(false)
  })

  it('validates with optional fields', () => {
    const result = insertUserSchema.safeParse({
      provider: 'github',
      externalId: '12345',
      accessToken: 'token',
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: 'https://example.com/avatar.jpg',
    })
    expect(result.success).toBe(true)
  })
})
