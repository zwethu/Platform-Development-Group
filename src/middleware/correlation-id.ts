import type { Context, Next } from 'hono'
import type { AppEnv } from '../lib/app-env'

const HEADER = 'x-correlation-id'

/**
 * Uses the incoming x-correlation-id when present, otherwise generates one.
 * Stored on context for handlers/error responses, and echoed on every
 * response (including 404s and uncaught-error responses — see the
 * app.onError handler in src/index.ts for the latter).
 */
export async function correlationId(c: Context<AppEnv>, next: Next) {
  const incoming = c.req.header(HEADER)?.trim()
  const id = incoming && incoming.length > 0 ? incoming : crypto.randomUUID()

  c.set('correlationId', id)
  await next()
  c.header(HEADER, id)
}
