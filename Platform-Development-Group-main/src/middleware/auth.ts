import type { Context, Next } from 'hono'
import type { AppEnv } from '../lib/app-env'
import type { UserRole } from '../lib/types'
import { sendError } from '../lib/http'
import { log } from '../lib/logger'
import { IdentityUnavailableError, verifyIdentityToken } from '../services/identity-client'

/**
 * Authentication (PRD FR-01 / NFR-03): who is calling.
 *
 * - `identity` mode (the default, and what every deployment uses): the caller
 *   sends `Authorization: Bearer <token>` issued by Student Identity (Team 01).
 *   We accept it only after Student Identity vouches for it — see
 *   src/services/identity-client.ts. The x-user-* headers are ignored, so a
 *   caller cannot claim a role.
 * - `demo-headers` mode: the old, unsigned x-user-id / x-user-role headers.
 *   Only for offline local development and tests, and only when
 *   AUTH_MODE=demo-headers is set explicitly. Never trusted in a deployment.
 *
 * Authorization (what they may do) stays ours: Student Identity's role
 * `student` maps to student; `instructor`, `staff` and `admin` map to
 * instructor; INSTRUCTOR_IDS can additionally grant instructor rights in the
 * Learning Assistant to specific Student Identity accounts.
 */

export type AuthMode = 'identity' | 'demo-headers'

export function authMode(env: Env | undefined): AuthMode {
  return env?.AUTH_MODE === 'demo-headers' ? 'demo-headers' : 'identity'
}

const VALID_ROLES: readonly UserRole[] = ['student', 'instructor']
const INSTRUCTOR_IDENTITY_ROLES = new Set(['instructor', 'staff', 'admin'])

function isUserRole(value: string): value is UserRole {
  return (VALID_ROLES as readonly string[]).includes(value)
}

/** Maps a Student Identity account to a Learning Assistant role, or null when it has none here. */
export function mapIdentityRole(identityRole: string, subject: string, instructorIds: string | undefined): UserRole | null {
  const allowList = (instructorIds ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (INSTRUCTOR_IDENTITY_ROLES.has(identityRole) || allowList.includes(subject)) return 'instructor'
  if (identityRole === 'student') return 'student'
  return null
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  if (authMode(c.env) === 'demo-headers') {
    const userId = c.req.header('x-user-id')?.trim()
    const role = c.req.header('x-user-role')?.trim()
    if (!userId || !role || !isUserRole(role)) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Authentication is required.')
    }
    c.set('user', { id: userId, role })
    return next()
  }

  const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) {
    return sendError(c, 401, 'UNAUTHORIZED', 'Sign in with Student Identity to continue.')
  }

  let principal
  try {
    principal = await verifyIdentityToken(c.env, token)
  } catch (err) {
    if (err instanceof IdentityUnavailableError) {
      log('warn', 'identity_unavailable', { correlationId: c.get('correlationId') })
      return sendError(c, 503, 'DEPENDENCY_UNAVAILABLE', 'Student Identity is not reachable right now. Please try again in a minute.')
    }
    throw err
  }
  if (!principal) {
    return sendError(c, 401, 'UNAUTHORIZED', 'Your sign-in is invalid or has expired. Please sign in again.')
  }

  const role = mapIdentityRole(principal.role, principal.sub, c.env?.INSTRUCTOR_IDS)
  if (!role) {
    return sendError(c, 403, 'FORBIDDEN', 'Your Student Identity account has no role in the Learning Assistant.')
  }

  c.set('user', { id: principal.sub, role })
  return next()
}

export function requireRole(...roles: UserRole[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user')
    if (!roles.includes(user.role)) {
      return sendError(c, 403, 'FORBIDDEN', 'You do not have access to this operation.')
    }
    await next()
  }
}
