import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('GET /v1/integration/status', () => {
  it('is public and returns the expected safe static metadata', async () => {
    const res = await app.request('/v1/integration/status') // no identity headers at all

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      data: {
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
      },
    })
  })

  it('echoes the correlation id header', async () => {
    const res = await app.request('/v1/integration/status', {
      headers: { 'x-correlation-id': 'status-check-1' },
    })

    expect(res.headers.get('x-correlation-id')).toBe('status-check-1')
  })
})
