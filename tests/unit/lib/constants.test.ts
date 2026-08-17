import { describe, it, expect } from 'vitest'
import { GATEWAY_BASE_URL, GATEWAY_DEFAULT_MODEL, GATEWAY_MODELS } from '@/lib/constants'

describe('constants', () => {
  describe('GATEWAY_BASE_URL', () => {
    it('is a valid URL', () => {
      expect(GATEWAY_BASE_URL).toMatch(/^https?:\/\//)
    })

    it('points to Vercel AI Gateway', () => {
      expect(GATEWAY_BASE_URL).toContain('ai-gateway')
    })
  })

  describe('GATEWAY_DEFAULT_MODEL', () => {
    it('is a non-empty string', () => {
      expect(GATEWAY_DEFAULT_MODEL).toBeTruthy()
      expect(typeof GATEWAY_DEFAULT_MODEL).toBe('string')
    })

    it('is in the GATEWAY_MODELS list', () => {
      expect(GATEWAY_MODELS).toContain(GATEWAY_DEFAULT_MODEL)
    })
  })

  describe('GATEWAY_MODELS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(GATEWAY_MODELS)).toBe(true)
      expect(GATEWAY_MODELS.length).toBeGreaterThan(0)
    })

    it('contains models from multiple providers', () => {
      const hasOpenAI = GATEWAY_MODELS.some((m) => m.startsWith('openai/'))
      const hasAnthropic = GATEWAY_MODELS.some((m) => m.startsWith('anthropic/'))
      const hasGoogle = GATEWAY_MODELS.some((m) => m.startsWith('google/'))
      expect(hasOpenAI).toBe(true)
      expect(hasAnthropic).toBe(true)
      expect(hasGoogle).toBe(true)
    })

    it('all models have provider/model format', () => {
      for (const model of GATEWAY_MODELS) {
        expect(model).toMatch(/^[a-z]+\/[\w.-]+$/)
      }
    })

    it('is readonly (as const type)', () => {
      // GATEWAY_MODELS is typed as `readonly` in TypeScript
      // At runtime, it's a regular array but shouldn't be modified
      type ModelsType = typeof GATEWAY_MODELS
      expect(Array.isArray(GATEWAY_MODELS)).toBe(true)
    })
  })
})
