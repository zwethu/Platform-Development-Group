// Student Identity (Team 01) sign-in: Bearer tokens are accepted only after
// Student Identity vouches for them (GET /me). Student Identity is mocked with
// global fetch: it accepts exactly the tokens it "issued" and nothing else.

import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import { mapIdentityRole } from '../src/middleware/auth'
import { clearIdentityCache } from '../src/services/identity-client'

const BASE = 'https://identity.test'
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600

function token(sub: string, role: string, exp = inAnHour()) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role, exp })}.signature-${sub}-${role}`
}

const STUDENT = token('6700000001', 'student')
const INSTRUCTOR = token('9000000001', 'instructor')
const STAFF = token('9000000002', 'staff')
const SERVICE = token('svc-maintenance', 'service')
const ISSUED = new Set([STUDENT, INSTRUCTOR, STAFF, SERVICE])

/** Fake Student Identity: GET /me answers 200 only for tokens it issued. */
function mockIdentity(override?: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (override) return override()
    const auth = new Headers(init?.headers).get('Authorization') ?? ''
    const ok = String(input) === `${BASE}/me` && ISSUED.has(auth.replace(/^Bearer /, ''))
    return ok
      ? new Response(JSON.stringify({ student_id: 'x', first_name: 'A', email: 'a@example.edu' }), { status: 200 })
      : new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
  })
}

const ENV = { IDENTITY_API_BASE: BASE }
const me = (headers: Record<string, string>, env: object = ENV) => app.request('/v1/me', { headers }, env)
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

afterEach(() => {
  vi.restoreAllMocks()
  clearIdentityCache()
})

describe('GET /v1/auth/config', () => {
  it('reports Student Identity sign-in by default, and demo headers only when configured', async () => {
    const def = (await (await app.request('/v1/auth/config', {}, ENV)).json()) as { data: { mode: string; identityProvider: { url: string } } }
    expect(def.data.mode).toBe('identity')
    expect(def.data.identityProvider.url).toBe(BASE)
    const demo = (await (await app.request('/v1/auth/config', {}, { AUTH_MODE: 'demo-headers' })).json()) as { data: { mode: string } }
    expect(demo.data.mode).toBe('demo-headers')
  })
})

describe('Student Identity sign-in (identity mode)', () => {
  it('accepts a token Student Identity vouches for and uses its subject and role', async () => {
    const fetchSpy = mockIdentity()
    const res = await me(bearer(STUDENT))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: unknown }).data).toEqual({ id: '6700000001', role: 'student', authMode: 'identity' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/me`)
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${STUDENT}`)
  })

  it('ignores the old x-user headers: claiming instructor without a token gets 401', async () => {
    const fetchSpy = mockIdentity()
    const res = await me({ 'x-user-id': 'attacker', 'x-user-role': 'instructor' })
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a token edited to claim a different role (Student Identity did not issue it)', async () => {
    mockIdentity()
    const [header, , sig] = STUDENT.split('.')
    const forged = `${header}.${b64url({ sub: '6700000001', role: 'admin', exp: inAnHour() })}.${sig}`
    expect((await me(bearer(forged))).status).toBe(401)
  })

  it('rejects expired and malformed tokens without calling Student Identity', async () => {
    const fetchSpy = mockIdentity()
    expect((await me(bearer(token('6700000001', 'student', Math.floor(Date.now() / 1000) - 10)))).status).toBe(401)
    expect((await me(bearer('not-a-jwt'))).status).toBe(401)
    expect((await me({ Authorization: 'Basic abc' })).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers 503 (not 401) when Student Identity is down', async () => {
    mockIdentity(() => Promise.reject(new TypeError('network down')))
    const down = await me(bearer(STUDENT))
    expect(down.status).toBe(503)
    expect(((await down.json()) as { error: { code: string } }).error.code).toBe('DEPENDENCY_UNAVAILABLE')

    vi.restoreAllMocks()
    mockIdentity(() => new Response('oops', { status: 502 }))
    expect((await me(bearer(STUDENT))).status).toBe(503)
  })

  it('caches a successful check briefly instead of asking on every request', async () => {
    const fetchSpy = mockIdentity()
    await me(bearer(STUDENT))
    await me(bearer(STUDENT))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('maps instructor and staff accounts to instructor, and refuses roles with no place here', async () => {
    mockIdentity()
    const roleOf = async (t: string) => ((await (await me(bearer(t))).json()) as { data: { role: string } }).data.role
    expect(await roleOf(INSTRUCTOR)).toBe('instructor')
    expect(await roleOf(STAFF)).toBe('instructor')
    expect((await me(bearer(SERVICE))).status).toBe(403)
  })

  it('enforces our own role rules on top: a student token cannot create a source', async () => {
    mockIdentity()
    const res = await app.request(
      '/v1/sources',
      { method: 'POST', headers: { ...bearer(STUDENT), 'content-type': 'application/json' }, body: JSON.stringify({ courseId: 'X', title: 'x', sourceType: 'document' }) },
      ENV,
    )
    expect(res.status).toBe(403)
  })

  it('INSTRUCTOR_IDS grants instructor rights to specific accounts', async () => {
    mockIdentity()
    const res = await me(bearer(STUDENT), { ...ENV, INSTRUCTOR_IDS: '9999999999, 6700000001' })
    expect(((await res.json()) as { data: { role: string } }).data.role).toBe('instructor')
  })
})

describe('mapIdentityRole', () => {
  it('maps Student Identity roles to Learning Assistant roles', () => {
    expect(mapIdentityRole('student', '1', undefined)).toBe('student')
    expect(mapIdentityRole('admin', '1', undefined)).toBe('instructor')
    expect(mapIdentityRole('student', '1', ' 1 ,2')).toBe('instructor')
    expect(mapIdentityRole('service', '1', undefined)).toBeNull()
  })
})
