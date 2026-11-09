// Route-level tests for the Assignment 5 outbound Team 17 integration
// routes (POST/GET /v1/integrations/team17/*). Real network calls never
// happen here — `fetch` is stubbed per test — and D1 access uses the same
// purpose-built fake as test/internship-webhook.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { createFakeD1 } from './helpers/fake-d1'

const TEST_KEY = 'test-integration-key'
const OUTBOUND_SECRET = 'test-outbound-secret'

function baseEnv(db: unknown) {
  return {
    INTEGRATION_TEST_KEY: TEST_KEY,
    TEAM17_OUTBOUND_WEBHOOK_SECRET: OUTBOUND_SECRET,
    learning_assistant_db: db,
  }
}

interface ErrorBody {
  error: { code: string; message: string; deliveryId?: string; partnerStatus?: number | null }
}

interface DataBody {
  data: Record<string, unknown> | unknown[]
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody
}

async function readDataBody(res: Response): Promise<DataBody> {
  return (await res.json()) as DataBody
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /v1/integrations/team17/test-send — auth', () => {
  it('returns 503 when INTEGRATION_TEST_KEY is not configured', async () => {
    const res = await app.request('/v1/integrations/team17/test-send', { method: 'POST' }, {})
    expect(res.status).toBe(503)
  })

  it('returns 401 when X-Integration-Test-Key is missing', async () => {
    const { db } = createFakeD1()
    const res = await app.request(
      '/v1/integrations/team17/test-send',
      { method: 'POST' },
      baseEnv(db),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-Integration-Test-Key is wrong', async () => {
    const { db } = createFakeD1()
    const res = await app.request(
      '/v1/integrations/team17/test-send',
      { method: 'POST', headers: { 'X-Integration-Test-Key': 'wrong-key' } },
      baseEnv(db),
    )
    expect(res.status).toBe(401)
  })
})

describe('POST /v1/integrations/team17/test-send — delivered', () => {
  it('logs the attempt as delivered on a 2xx partner response', async () => {
    const { db, _inspect } = createFakeD1()
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sentHeaders = init.headers as Record<string, string>
      expect(sentHeaders['X-Webhook-Secret']).toBe(OUTBOUND_SECRET)
      const sentBody = JSON.parse(init.body as string)
      expect(sentBody.event_type).toBe('partner.updated')
      expect(sentBody.source).toBe('team-08-learning-assistant')

      return new Response(JSON.stringify({ success: true, message: 'Webhook accepted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.request(
      '/v1/integrations/team17/test-send',
      { method: 'POST', headers: { 'X-Integration-Test-Key': TEST_KEY } },
      baseEnv(db),
    )

    expect(res.status).toBe(200)
    const body = await readDataBody(res)
    expect((body.data as Record<string, unknown>).status).toBe('delivered')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(_inspect.outboundDeliveries.size).toBe(1)
    const [delivery] = Array.from(_inspect.outboundDeliveries.values())
    expect(delivery.status).toBe('delivered')
    expect(delivery.response_status).toBe(200)
  })

  it('rejects unsupported body fields with 400', async () => {
    const { db } = createFakeD1()
    const res = await app.request(
      '/v1/integrations/team17/test-send',
      {
        method: 'POST',
        headers: { 'X-Integration-Test-Key': TEST_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination_url: 'https://evil.example/hook' }),
      },
      baseEnv(db),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /v1/integrations/team17/test-send — failure', () => {
  it('logs a non-2xx partner response as failed and returns a safe 502', async () => {
    const { db, _inspect } = createFakeD1()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Internal Server Error', { status: 500 })),
    )

    const res = await app.request(
      '/v1/integrations/team17/test-send',
      { method: 'POST', headers: { 'X-Integration-Test-Key': TEST_KEY } },
      baseEnv(db),
    )

    expect(res.status).toBe(502)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('PARTNER_WEBHOOK_DELIVERY_FAILED')
    expect(body.error.partnerStatus).toBe(500)
    expect(typeof body.error.deliveryId).toBe('string')

    const [delivery] = Array.from(_inspect.outboundDeliveries.values())
    expect(delivery.status).toBe('failed')
    expect(delivery.response_status).toBe(500)
  })

  it('logs a network error as failed and returns a safe 502 with null partnerStatus', async () => {
    const { db, _inspect } = createFakeD1()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed: network unreachable')
      }),
    )

    const res = await app.request(
      '/v1/integrations/team17/test-send',
      { method: 'POST', headers: { 'X-Integration-Test-Key': TEST_KEY } },
      baseEnv(db),
    )

    expect(res.status).toBe(502)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('PARTNER_WEBHOOK_DELIVERY_FAILED')
    expect(body.error.partnerStatus).toBeNull()

    const [delivery] = Array.from(_inspect.outboundDeliveries.values())
    expect(delivery.status).toBe('failed')
    expect(delivery.response_status).toBeNull()
  })
})

describe('GET /v1/integrations/team17/deliveries', () => {
  it('returns 401 without a valid X-Integration-Test-Key', async () => {
    const { db } = createFakeD1()
    const res = await app.request('/v1/integrations/team17/deliveries', {}, baseEnv(db))
    expect(res.status).toBe(401)
  })

  it('lists recorded deliveries and never includes a secret or header', async () => {
    const { db } = createFakeD1()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
    )

    await app.request(
      '/v1/integrations/team17/test-send',
      { method: 'POST', headers: { 'X-Integration-Test-Key': TEST_KEY } },
      baseEnv(db),
    )

    const res = await app.request(
      '/v1/integrations/team17/deliveries',
      { headers: { 'X-Integration-Test-Key': TEST_KEY } },
      baseEnv(db),
    )

    expect(res.status).toBe(200)
    const body = await readDataBody(res)
    const deliveries = body.data as Record<string, unknown>[]
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].status).toBe('delivered')
    expect(JSON.stringify(deliveries[0])).not.toContain(OUTBOUND_SECRET)
    expect(deliveries[0]).not.toHaveProperty('headers')
  })
})
