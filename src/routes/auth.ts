import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { sendData } from '../lib/http'
import { authMode, requireAuth } from '../middleware/auth'
import { identityBaseUrl } from '../services/identity-client'

export const auth = new Hono<AppEnv>()

/** Public: tells the UI how to sign in. No secrets — the identity URL is public. */
auth.get('/auth/config', (c) => {
  const mode = authMode(c.env)
  return sendData(c, 200, {
    mode,
    identityProvider: mode === 'identity' ? { name: 'Student Identity (Team 01)', url: identityBaseUrl(c.env) } : null,
  })
})

/** The signed-in caller as the Learning Assistant sees them (after role mapping). */
auth.get('/me', requireAuth, (c) => {
  const user = c.get('user')
  return sendData(c, 200, { id: user.id, role: user.role, authMode: authMode(c.env) })
})
