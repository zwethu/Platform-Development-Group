import { Hono } from 'hono'
import type { AppEnv } from './lib/app-env'
import { health } from './routes/health'
import { sources } from './routes/sources'
import { questions } from './routes/questions'
import { feedback } from './routes/feedback'
import { correlationId } from './middleware/correlation-id'
import { jsonError } from './lib/http-error'
import { sendError } from './lib/http'

const app = new Hono<AppEnv>()

app.use('*', correlationId)

const v1 = new Hono<AppEnv>()
v1.route('/', health) // unauthenticated, unchanged
v1.route('/', sources)
v1.route('/', questions)
v1.route('/', feedback)

app.route('/v1', v1)

app.notFound((c) => jsonError(c, 404, 'not_found', 'Not found'))

app.onError((err, c) => {
  console.error('Unhandled request error', err)
  c.header('x-correlation-id', c.get('correlationId') ?? crypto.randomUUID())
  return sendError(c, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
})

export default app
