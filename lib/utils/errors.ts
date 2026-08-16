export class AppError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.status = status
  }
}

export class PlanSchemaError extends AppError {
  constructor(message = 'Invalid plan') {
    super(message, 'PLAN_SCHEMA_ERROR', 400)
  }
}

export class SandboxTimeoutError extends AppError {
  constructor(message = 'Sandbox timed out') {
    super(message, 'SANDBOX_TIMEOUT', 504)
  }
}

export class SteerThrottledError extends AppError {
  constructor(message = 'Too many steering messages') {
    super(message, 'STEER_THROTTLED', 429)
  }
}

export class CheckRunAlreadyProcessedError extends AppError {
  constructor(message = 'Check run already processed') {
    super(message, 'CHECK_RUN_PROCESSED', 200)
  }
}

export class AudioNotReadyError extends AppError {
  constructor(message = 'Audio not ready') {
    super(message, 'AUDIO_NOT_READY', 400)
  }
}

export function toErrorResponse(err: unknown): { error: string; code: string; status: number } {
  if (err instanceof AppError) {
    return { error: err.message, code: err.code, status: err.status }
  }
  if (err instanceof Error) {
    return { error: err.message, code: 'INTERNAL', status: 500 }
  }
  return { error: 'Internal error', code: 'INTERNAL', status: 500 }
}
