import type { Context, Next } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { log } from '../lib/logger'

/**
 * One `http_request` log line per request with exactly the fields NFR-11 asks
 * for: correlation id, route, caller role, status, duration. Runs after
 * correlationId so the id is already set. The route is the matched pattern
 * (`/v1/questions/:id`), not the raw path, so ids do not leak into route stats.
 */
export async function requestLogger(c: Context<AppEnv>, next: Next) {
  const started = Date.now()
  await next()
  const status = c.res.status
  log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'http_request', {
    correlationId: c.get('correlationId'),
    method: c.req.method,
    route: c.req.routePath,
    path: c.req.path,
    role: c.get('user')?.role ?? c.req.header('x-user-role') ?? 'anonymous',
    status,
    durationMs: Date.now() - started,
  })
}
