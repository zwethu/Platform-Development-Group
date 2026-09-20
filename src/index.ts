import { Hono } from 'hono'
import { health } from './routes/health'
import { jsonError } from './lib/http-error'

const app = new Hono()

const v1 = new Hono()
v1.route('/', health)

app.route('/v1', v1)

app.notFound((c) => jsonError(c, 404, 'not_found', 'Not found'))

export default app
