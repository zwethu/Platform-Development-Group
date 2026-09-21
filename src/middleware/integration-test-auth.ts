import type { Context, Next } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { sendError } from '../lib/http'

const HEADER = 'X-Integration-Test-Key'

/**
 * Gates the Assignment-5-only routes under /v1/integrations/team17/*
 * (test-send, deliveries) behind a shared key distinct from both the
 * partner webhook signature (src/lib/webhook-signature.ts) and the
 * temporary x-user-id/x-user-role identity headers (src/middleware/auth.ts)
 * — these are internal evidence/testing routes, not a partner-facing or
 * human-facing contract, and must never be reachable in production without
 * this key.
 */
export async function requireIntegrationTestKey(c: Context<AppEnv>, next: Next) {
  const configured = c.env.INTEGRATION_TEST_KEY
  if (!configured) {
    return sendError(c, 503, 'CONFIGURATION_ERROR', 'Integration test routes are not configured yet.')
  }

  const provided = c.req.header(HEADER)
  if (!provided || provided !== configured) {
    return sendError(c, 401, 'UNAUTHORIZED', 'Missing or invalid X-Integration-Test-Key.')
  }

  await next()
}
