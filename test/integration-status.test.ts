import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('GET /v1/integration/status', () => {
  it('is public and returns the expected safe static metadata', async () => {
    const res = await app.request('/v1/integration/status') // no identity headers at all

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({
      service: 'team-08-learning-assistant',
      team: 'Team 08',
      status: 'ok',
      integration: {
        partner: 'team-17-internship',
        inboundWebhook: '/v1/webhooks/internship',
      },
    })
    expect(typeof body.data.timestamp).toBe('string')
    expect(new Date(body.data.timestamp as string).toISOString()).toBe(body.data.timestamp)
  })

  it('echoes the correlation id header', async () => {
    const res = await app.request('/v1/integration/status', {
      headers: { 'x-correlation-id': 'status-check-1' },
    })

    expect(res.headers.get('x-correlation-id')).toBe('status-check-1')
  })
})
