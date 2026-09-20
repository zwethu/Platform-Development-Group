import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { sendData } from '../lib/http'

// Public — no requireAuth. Static, safe metadata only; never anything
// from env, secrets, or the database.
export const integration = new Hono<AppEnv>()

integration.get('/integration/status', (c) => {
  return sendData(c, 200, {
    service: 'learning-assistant',
    team: '08',
    status: 'ready',
    version: 'v1',
    integration: {
      partner: 'internship',
      inboundWebhookPath: '/v1/webhooks/internship',
      inboundEventType: 'internship.opportunity.published',
      outboundEventType: 'learning.questioned',
    },
  })
})
