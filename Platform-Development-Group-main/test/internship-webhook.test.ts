// Route-level tests for POST /v1/webhooks/internship.
//
// The config/signature/validation paths below resolve before any D1
// access, so they run against the real app with no database at all — if
// one of them ever reached the database, it would fail loudly (see the
// fake D1's "unsupported" errors) rather than silently pass.
//
// The accept/idempotency paths do reach D1, so they use the small
// purpose-built fake in ./helpers/fake-d1.ts (per the task's own
// guidance to test idempotency logic with mocks rather than add a new
// D1 test harness). Real SQL correctness against this schema was
// verified separately in Assignment 3 and is exercised again manually
// per README's local D1 test procedure.

import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { createFakeD1 } from './helpers/fake-d1'

const SECRET = 'test-webhook-secret'

interface ErrorBody {
  error: { code: string; message: string; correlationId?: string }
}

interface DataBody {
  data: Record<string, unknown>
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody
}

async function readDataBody(res: Response): Promise<DataBody> {
  return (await res.json()) as DataBody
}

async function computeHmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function validPayload(eventId: string): string {
  return JSON.stringify({
    eventId,
    type: 'internship.opportunity.published',
    occurredAt: '2026-09-21T00:00:00.000Z',
    source: 'team-17-internship',
    subject: 'opportunity:int-001',
    data: {
      opportunityId: 'int-001',
      title: 'Software Engineering Internship',
      companyName: 'Demo Technology Co.',
      description: 'Support web application development.',
      requirements: ['Resume', 'GitHub profile'],
      applicationDeadline: '2026-10-15T16:59:00.000Z',
      url: 'https://example.invalid/internships/int-001',
    },
  })
}

describe('POST /v1/webhooks/internship — configuration', () => {
  it('returns 503 CONFIGURATION_ERROR when INTERNSHIP_WEBHOOK_SECRET is missing', async () => {
    const res = await app.request('/v1/webhooks/internship', { method: 'POST', body: validPayload('evt-cfg-1') }, {})

    expect(res.status).toBe(503)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('CONFIGURATION_ERROR')
  })
})

describe('POST /v1/webhooks/internship — signature', () => {
  it('returns 401 when the signature header is missing', async () => {
    const res = await app.request(
      '/v1/webhooks/internship',
      { method: 'POST', body: validPayload('evt-sig-1') },
      { INTERNSHIP_WEBHOOK_SECRET: SECRET },
    )

    expect(res.status).toBe(401)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 for an invalid signature', async () => {
    const res = await app.request(
      '/v1/webhooks/internship',
      {
        method: 'POST',
        headers: { 'X-Webhook-Signature': '00'.repeat(32) },
        body: validPayload('evt-sig-2'),
      },
      { INTERNSHIP_WEBHOOK_SECRET: SECRET },
    )

    expect(res.status).toBe(401)
  })
})

describe('POST /v1/webhooks/internship — validation', () => {
  it('returns 400 for a validly signed but invalid payload', async () => {
    const payload = JSON.stringify({ eventId: 'evt-invalid-1' }) // missing required fields
    const signature = await computeHmacHex(SECRET, payload)

    const res = await app.request(
      '/v1/webhooks/internship',
      { method: 'POST', headers: { 'X-Webhook-Signature': signature }, body: payload },
      { INTERNSHIP_WEBHOOK_SECRET: SECRET },
    )

    expect(res.status).toBe(400)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for malformed JSON, even with a valid signature over that exact text', async () => {
    const payload = '{not valid json'
    const signature = await computeHmacHex(SECRET, payload)

    const res = await app.request(
      '/v1/webhooks/internship',
      { method: 'POST', headers: { 'X-Webhook-Signature': signature }, body: payload },
      { INTERNSHIP_WEBHOOK_SECRET: SECRET },
    )

    expect(res.status).toBe(400)
  })
})

describe('POST /v1/webhooks/internship — accepted + idempotent (mocked D1)', () => {
  it('accepts a validly signed new event and creates exactly one knowledge source', async () => {
    const { db, _inspect } = createFakeD1()
    const payload = validPayload('evt-accept-1')
    const signature = await computeHmacHex(SECRET, payload)

    const res = await app.request(
      '/v1/webhooks/internship',
      { method: 'POST', headers: { 'X-Webhook-Signature': signature }, body: payload },
      { INTERNSHIP_WEBHOOK_SECRET: SECRET, learning_assistant_db: db },
    )

    expect(res.status).toBe(202)
    const body = await readDataBody(res)
    expect(body.data.status).toBe('accepted')
    expect(body.data.eventId).toBe('evt-accept-1')
    expect(typeof body.data.knowledgeSourceId).toBe('string')

    expect(_inspect.knowledgeSources).toHaveLength(1)
    expect(_inspect.knowledgeSources[0]).toMatchObject({
      course_id: 'CAREER',
      title: 'Internship: Software Engineering Internship',
      source_type: 'internship_opportunity',
      status: 'approved',
      created_by: 'team-17-internship',
    })
    expect(_inspect.receivedEvents.get('evt-accept-1')?.processing_status).toBe('processed')
  })

  it('returns 200 duplicate on a replayed eventId and does not create a second source', async () => {
    const { db, _inspect } = createFakeD1()
    const payload = validPayload('evt-dup-1')
    const signature = await computeHmacHex(SECRET, payload)
    const env = { INTERNSHIP_WEBHOOK_SECRET: SECRET, learning_assistant_db: db }

    const first = await app.request(
      '/v1/webhooks/internship',
      { method: 'POST', headers: { 'X-Webhook-Signature': signature }, body: payload },
      env,
    )
    expect(first.status).toBe(202)

    const second = await app.request(
      '/v1/webhooks/internship',
      { method: 'POST', headers: { 'X-Webhook-Signature': signature }, body: payload },
      env,
    )
    expect(second.status).toBe(200)
    const secondBody = await readDataBody(second)
    expect(secondBody.data).toEqual({ eventId: 'evt-dup-1', status: 'duplicate', processed: false, duplicate: true })

    expect(_inspect.knowledgeSources).toHaveLength(1)
  })
})
