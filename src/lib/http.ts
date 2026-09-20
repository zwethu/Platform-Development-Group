import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from './app-env'

// Response envelope for the v1 business routes (sources/questions/feedback):
//   success -> { data: ... }
//   error   -> { error: { code, message, correlationId } }
// This is distinct from src/lib/http-error.ts, which the pre-existing
// health/404 paths already use — see README/API notes for that split.

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'CONFIGURATION_ERROR'

export function sendData<T>(c: Context<AppEnv>, status: ContentfulStatusCode, data: T) {
  return c.json({ data }, status)
}

export function sendError(c: Context<AppEnv>, status: ContentfulStatusCode, code: ErrorCode, message: string) {
  return c.json(
    {
      error: {
        code,
        message,
        correlationId: c.get('correlationId'),
      },
    },
    status,
  )
}
