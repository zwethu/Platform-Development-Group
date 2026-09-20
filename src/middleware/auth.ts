import type { Context, Next } from 'hono'
import type { AppEnv } from '../lib/app-env'
import type { UserRole } from '../lib/types'
import { sendError } from '../lib/http'

/**
 * TEMPORARY identity scaffolding for this vertical slice only.
 *
 * Reads the caller's identity from plain, unsigned request headers instead
 * of verifying a real Student Identity token (see PRD.md FR-01 / NFR-03).
 * There is no signature check and this must never be trusted in a real
 * deployment — replace with real Identity/JWT verification before this
 * goes beyond the course project.
 */

const VALID_ROLES: readonly UserRole[] = ['student', 'instructor']

function isUserRole(value: string): value is UserRole {
  return (VALID_ROLES as readonly string[]).includes(value)
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const userId = c.req.header('x-user-id')?.trim()
  const role = c.req.header('x-user-role')?.trim()

  if (!userId || !role || !isUserRole(role)) {
    return sendError(c, 401, 'UNAUTHORIZED', 'Authentication is required.')
  }

  c.set('user', { id: userId, role })
  await next()
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
