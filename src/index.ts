import { Hono } from 'hono'
import type { AppEnv } from './lib/app-env'
import { health } from './routes/health'
import { sources } from './routes/sources'
import { questions } from './routes/questions'
import { feedback } from './routes/feedback'
import { replies } from './routes/replies'
import { courses } from './routes/courses'
import { integration } from './routes/integration'
import { webhooks } from './routes/webhooks'
import { team17Integration } from './routes/team17-integration'
import { auth } from './routes/auth'
import { correlationId } from './middleware/correlation-id'
import { requestLogger } from './middleware/request-logger'
import { log } from './lib/logger'
import { jsonError } from './lib/http-error'
import { sendError } from './lib/http'

const app = new Hono<AppEnv>()

app.use('*', correlationId)
app.use('*', requestLogger)

const v1 = new Hono<AppEnv>()
v1.route('/', health) // unauthenticated, unchanged
v1.route('/', auth) // /auth/config (public) and /me (Student Identity sign-in)
v1.route('/', courses) // instructors create courses; sources and questions must belong to one
v1.route('/', sources)
v1.route('/', questions)
v1.route('/', feedback)
v1.route('/', replies) // instructor replies, "Ask my instructor", inbox, my questions
v1.route('/', integration) // public, no temporary auth headers required
v1.route('/', webhooks) // Team 17 inbound webhook, signature-authenticated instead
v1.route('/', team17Integration) // Assignment 5 outbound test-send + deliveries, X-Integration-Test-Key gated

app.route('/v1', v1)

app.notFound((c) => jsonError(c, 404, 'not_found', 'Not found'))

app.onError((err, c) => {
  const correlationId = c.get('correlationId') ?? crypto.randomUUID()
  log('error', 'unhandled_error', {
    correlationId,
    method: c.req.method,
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  c.header('x-correlation-id', correlationId)
  return sendError(c, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
})

export default app
