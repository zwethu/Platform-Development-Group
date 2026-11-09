// Verifies Student Identity (Team 01) sign-in tokens.
//
// Student Identity issues the token when a user signs in on THEIR service; the
// browser sends it to us as `Authorization: Bearer <token>`. They publish no
// signing keys (no JWKS), so we cannot check the signature ourselves. Instead
// we ask them: GET /me with the token answers 200 only for a genuine,
// unexpired, non-suspended token. Once they have vouched for the token, its
// payload (`sub`, `role`, `exp`) is trustworthy and is what we use.
//
// The /me response body (name, email, …) is discarded: we need only who the
// caller is and their role (data minimisation, PDPA). Tokens are never logged.
// A successful check is cached per Worker instance for at most 60 s (never
// past the token's own expiry), keyed by a SHA-256 of the token.

export const DEFAULT_IDENTITY_API_BASE = 'https://student-identity.onrender.com'
const TIMEOUT_MS = 25_000 // their free hosting can take a while to wake up
const CACHE_MS = 60_000
const CACHE_MAX = 500

export interface IdentityPrincipal {
  sub: string
  role: string
}

/** Student Identity could not be reached or failed; the caller should answer 503, not 401. */
export class IdentityUnavailableError extends Error {
  constructor(message = 'Student Identity is not reachable right now.') {
    super(message)
    this.name = 'IdentityUnavailableError'
  }
}

const cache = new Map<string, { principal: IdentityPrincipal; until: number }>()

export function identityBaseUrl(env: Env | undefined): string {
  return (env?.IDENTITY_API_BASE || DEFAULT_IDENTITY_API_BASE).replace(/\/+$/, '')
}

/** Reads a JWT payload WITHOUT verifying it. Only trusted after Student Identity accepts the token. */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as unknown
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function cacheKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Returns who the token belongs to, or null when it is not a valid Student
 * Identity token. Throws IdentityUnavailableError when Student Identity is down.
 */
export async function verifyIdentityToken(env: Env | undefined, token: string, now = Date.now()): Promise<IdentityPrincipal | null> {
  const payload = decodeTokenPayload(token)
  if (!payload || typeof payload.sub !== 'string' || !payload.sub || typeof payload.role !== 'string') return null
  const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : null
  if (expMs !== null && expMs <= now) return null // expired: no need to ask

  const key = await cacheKey(token)
  const hit = cache.get(key)
  if (hit && hit.until > now) return hit.principal

  let res: Response
  try {
    res = await fetch(`${identityBaseUrl(env)}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new IdentityUnavailableError()
  }
  // Drain the body without keeping it: we do not store their profile data.
  await res.arrayBuffer().catch(() => undefined)

  if (res.status >= 500) throw new IdentityUnavailableError()
  if (!res.ok) return null // 401 invalid/expired, 403 suspended, …

  const principal = { sub: payload.sub, role: payload.role }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, { principal, until: Math.min(now + CACHE_MS, expMs ?? Infinity) })
  return principal
}

/** For tests: forget cached verifications. */
export function clearIdentityCache(): void {
  cache.clear()
}
