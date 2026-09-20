// These exercise the real Hono app end-to-end (real middleware, real route
// handlers) for every code path that resolves *before* touching D1: missing
// identity headers, wrong role, and malformed/invalid request bodies. None
// of these need a database, so `app.request()` is used with no env bound —
// if a test ever reached the D1 layer, it would fail loudly rather than
// silently pass, which is the point.
//
// The project's current Vitest setup (plain Node environment, no
// `@cloudflare/vitest-pool-workers`) does not provide a real D1 binding, so
// the success-path (200/201) behavior of these routes is not covered here.
// See TESTING NOTES in the task report for what a full integration setup
// would add.

import { describe, expect, it } from 'vitest'
import app from '../src/index'

interface ErrorBody {
  error: { code: string; message: string; correlationId?: string }
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody
}

describe('temporary identity headers', () => {
  it('rejects a request with no identity headers at all', async () => {
    const res = await app.request('/v1/questions/does-not-matter')

    expect(res.status).toBe(401)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects a request missing x-user-role', async () => {
    const res = await app.request('/v1/questions/does-not-matter', {
      headers: { 'x-user-id': 'u1' },
    })

    expect(res.status).toBe(401)
  })

  it('rejects an invalid x-user-role value', async () => {
    const res = await app.request('/v1/questions/does-not-matter', {
      headers: { 'x-user-id': 'u1', 'x-user-role': 'admin' },
    })

    expect(res.status).toBe(401)
  })
})

describe('role restrictions on /v1/sources', () => {
  const studentHeaders = { 'x-user-id': 's1', 'x-user-role': 'student' }

  it('forbids a student from creating a source', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: { ...studentHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: 'SE101', title: 'x', sourceType: 'document' }),
    })

    expect(res.status).toBe(403)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('forbids a student from updating a source', async () => {
    const res = await app.request('/v1/sources/some-id', {
      method: 'PATCH',
      headers: { ...studentHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New title' }),
    })

    expect(res.status).toBe(403)
  })

  it('forbids a student from archiving (deleting) a source', async () => {
    const res = await app.request('/v1/sources/some-id', {
      method: 'DELETE',
      headers: studentHeaders,
    })

    expect(res.status).toBe(403)
  })
})

describe('request body validation on /v1/sources (instructor)', () => {
  const instructorHeaders = { 'x-user-id': 'i1', 'x-user-role': 'instructor' }

  it('rejects malformed JSON with 400 VALIDATION_ERROR', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: { ...instructorHeaders, 'content-type': 'application/json' },
      body: '{not valid json',
    })

    expect(res.status).toBe(400)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects an empty required field', async () => {
    const res = await app.request('/v1/sources', {
      method: 'POST',
      headers: { ...instructorHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: '   ', title: 'x', sourceType: 'document' }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects an empty PATCH body', async () => {
    const res = await app.request('/v1/sources/some-id', {
      method: 'PATCH',
      headers: { ...instructorHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })
})

describe('feedback rating validation', () => {
  const headers = { 'x-user-id': 'u1', 'x-user-role': 'student', 'content-type': 'application/json' }

  it('rejects a rating outside 1-5 before ever touching the database', async () => {
    const res = await app.request('/v1/answers/feedback', {
      method: 'POST',
      headers,
      body: JSON.stringify({ answerId: 'a1', rating: 6 }),
    })

    expect(res.status).toBe(400)
    const body = await readErrorBody(res)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a non-integer rating', async () => {
    const res = await app.request('/v1/answers/feedback', {
      method: 'POST',
      headers,
      body: JSON.stringify({ answerId: 'a1', rating: 3.5 }),
    })

    expect(res.status).toBe(400)
  })
})

describe('correlation id', () => {
  it('echoes an incoming x-correlation-id on a successful response', async () => {
    const res = await app.request('/v1/health', {
      headers: { 'x-correlation-id': 'given-id-123' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-correlation-id')).toBe('given-id-123')
  })

  it('generates a correlation id when none is supplied', async () => {
    const res = await app.request('/v1/health')

    expect(res.status).toBe(200)
    expect(res.headers.get('x-correlation-id')).toBeTruthy()
  })

  it('includes the correlation id in both the header and the JSON body on an error response', async () => {
    const res = await app.request('/v1/questions/does-not-matter', {
      headers: { 'x-correlation-id': 'error-case-456' },
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('x-correlation-id')).toBe('error-case-456')
    const body = await readErrorBody(res)
    expect(body.error.correlationId).toBe('error-case-456')
  })
})
