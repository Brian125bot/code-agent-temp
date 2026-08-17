import { describe, it, expect } from 'vitest'
import {
  AppError,
  PlanSchemaError,
  SandboxTimeoutError,
  SteerThrottledError,
  CheckRunAlreadyProcessedError,
  AudioNotReadyError,
  toErrorResponse,
} from '@/lib/utils/errors'

describe('AppError', () => {
  it('stores message, code, and status', () => {
    const err = new AppError('Something failed', 'TEST_ERROR', 400)
    expect(err.message).toBe('Something failed')
    expect(err.code).toBe('TEST_ERROR')
    expect(err.status).toBe(400)
    expect(err.name).toBe('AppError')
  })

  it('is instance of Error', () => {
    const err = new AppError('test', 'CODE', 500)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(AppError)
  })
})

describe('PlanSchemaError', () => {
  it('has correct defaults', () => {
    const err = new PlanSchemaError()
    expect(err.message).toBe('Invalid plan')
    expect(err.code).toBe('PLAN_SCHEMA_ERROR')
    expect(err.status).toBe(400)
    expect(err.name).toBe('PlanSchemaError')
  })

  it('accepts custom message', () => {
    const err = new PlanSchemaError('Custom error')
    expect(err.message).toBe('Custom error')
  })

  it('is instance of AppError', () => {
    expect(new PlanSchemaError()).toBeInstanceOf(AppError)
  })
})

describe('SandboxTimeoutError', () => {
  it('has correct defaults', () => {
    const err = new SandboxTimeoutError()
    expect(err.message).toBe('Sandbox timed out')
    expect(err.code).toBe('SANDBOX_TIMEOUT')
    expect(err.status).toBe(504)
  })

  it('is instance of AppError', () => {
    expect(new SandboxTimeoutError()).toBeInstanceOf(AppError)
  })
})

describe('SteerThrottledError', () => {
  it('has correct defaults', () => {
    const err = new SteerThrottledError()
    expect(err.message).toBe('Too many steering messages')
    expect(err.code).toBe('STEER_THROTTLED')
    expect(err.status).toBe(429)
  })

  it('is instance of AppError', () => {
    expect(new SteerThrottledError()).toBeInstanceOf(AppError)
  })
})

describe('CheckRunAlreadyProcessedError', () => {
  it('has correct defaults', () => {
    const err = new CheckRunAlreadyProcessedError()
    expect(err.message).toBe('Check run already processed')
    expect(err.code).toBe('CHECK_RUN_PROCESSED')
    expect(err.status).toBe(200)
  })
})

describe('AudioNotReadyError', () => {
  it('has correct defaults', () => {
    const err = new AudioNotReadyError()
    expect(err.message).toBe('Audio not ready')
    expect(err.code).toBe('AUDIO_NOT_READY')
    expect(err.status).toBe(400)
  })
})

describe('toErrorResponse', () => {
  it('converts AppError to error response', () => {
    const err = new AppError('Not found', 'NOT_FOUND', 404)
    const response = toErrorResponse(err)
    expect(response).toEqual({
      error: 'Not found',
      code: 'NOT_FOUND',
      status: 404,
    })
  })

  it('converts generic Error to error response', () => {
    const err = new Error('Something went wrong')
    const response = toErrorResponse(err)
    expect(response).toEqual({
      error: 'Something went wrong',
      code: 'INTERNAL',
      status: 500,
    })
  })

  it('converts non-Error values to error response', () => {
    expect(toErrorResponse('string error')).toEqual({
      error: 'Internal error',
      code: 'INTERNAL',
      status: 500,
    })

    expect(toErrorResponse(null)).toEqual({
      error: 'Internal error',
      code: 'INTERNAL',
      status: 500,
    })

    expect(toErrorResponse(undefined)).toEqual({
      error: 'Internal error',
      code: 'INTERNAL',
      status: 500,
    })

    expect(toErrorResponse(42)).toEqual({
      error: 'Internal error',
      code: 'INTERNAL',
      status: 500,
    })
  })

  it('converts subclass errors correctly', () => {
    const err = new PlanSchemaError()
    const response = toErrorResponse(err)
    expect(response.code).toBe('PLAN_SCHEMA_ERROR')
    expect(response.status).toBe(400)
  })
})
