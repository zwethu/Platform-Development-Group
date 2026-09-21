import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { sendData } from '../lib/http'

// Public — no requireAuth. Static, safe metadata only; never anything
// from env, secrets, or the database.
export const integration = new Hono<AppEnv>()

integration.get('/integration/status', (c) => {
  return sendData(c, 200, {
    service: 'team-08-learning-assistant',
    team: 'Team 08',
    status: 'ok',
    timestamp: new Date().toISOString(),
    integration: {
      partner: 'team-17-internship',
      inboundWebhook: '/v1/webhooks/internship',
    },
  })
})
