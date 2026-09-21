import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { sendData, sendError } from '../lib/http'
import { ValidationError, requireNonEmptyString } from '../lib/validation'
import { requireIntegrationTestKey } from '../middleware/integration-test-auth'
import { getDb } from '../lib/db'
import {
  completeOutboundDelivery,
  insertOutboundDelivery,
  listRecentOutboundDeliveries,
} from '../repositories/outbound-deliveries-repository'

/**
 * Assignment 5 — outbound side of the Team 17 (Internship) integration.
 * Sends an agreed handshake/test webhook to Team 17's partner receiver and
 * records every attempt for Assignment 5 evidence. Not part of the public
 * API surface, and not authenticated the way any other route in this
 * service is: gated by X-Integration-Test-Key only (see
 * ../middleware/integration-test-auth.ts), never by the temporary
 * x-user-id/x-user-role identity headers or a partner webhook signature.
 *
 * This event payload/contract is a provisional development handshake —
 * subject to change once both Team 08 and Team 17 formally confirm it. See
 * docs/team17-integration-contract.md.
 */
export const team17Integration = new Hono<AppEnv>()

const PARTNER = 'team-17-internship'
const TEAM17_WEBHOOK_URL = 'https://team17-internship.vercel.app/api/webhooks/partner'
const DEFAULT_RESOURCE_ID = 'learning-assistant-demo-001'
const DEFAULT_STATUS = 'updated'
const ALLOWED_BODY_KEYS = new Set(['resource_id', 'status'])
const RECENT_DELIVERIES_LIMIT = 20

team17Integration.use('/integrations/team17/*', requireIntegrationTestKey)

team17Integration.post('/integrations/team17/test-send', async (c) => {
  const secret = c.env.TEAM17_OUTBOUND_WEBHOOK_SECRET
  if (!secret) {
    return sendError(c, 503, 'CONFIGURATION_ERROR', 'Team 17 outbound webhook secret is not configured yet.')
  }

  let resourceId = DEFAULT_RESOURCE_ID
  let status = DEFAULT_STATUS

  const rawBody = await c.req.text()
  if (rawBody.trim().length > 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return sendError(c, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return sendError(c, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object.')
    }
    const body = parsed as Record<string, unknown>

    const unknownKeys = Object.keys(body).filter((key) => !ALLOWED_BODY_KEYS.has(key))
    if (unknownKeys.length > 0) {
      return sendError(c, 400, 'VALIDATION_ERROR', `Unsupported field(s): ${unknownKeys.join(', ')}. Only resource_id and status are accepted.`)
    }

    try {
      if (body.resource_id !== undefined) resourceId = requireNonEmptyString(body.resource_id, 'resource_id')
      if (body.status !== undefined) status = requireNonEmptyString(body.status, 'status')
    } catch (err) {
      if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
      throw err
    }
  }

  const eventId = `team08-team17-handshake-${crypto.randomUUID()}`
  const occurredAt = new Date().toISOString()
  const deliveryId = crypto.randomUUID()

  const payload = {
    event_id: eventId,
    event_type: 'partner.updated',
    occurred_at: occurredAt,
    source: 'team-08-learning-assistant',
    data: { resource_id: resourceId, status },
  }
  const payloadJson = JSON.stringify(payload)

  const db = getDb(c.env)
  await insertOutboundDelivery(db, {
    id: deliveryId,
    partner: PARTNER,
    eventId,
    endpoint: TEAM17_WEBHOOK_URL,
    requestPayloadJson: payloadJson,
    attemptedAt: occurredAt,
  })

  try {
    const response = await fetch(TEAM17_WEBHOOK_URL, {
      method: 'POST',
      // Never log or persist these headers — the secret must not end up in
      // outbound_webhook_deliveries (see the repository's insert/complete
      // functions, which take no header/secret input at all).
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
      body: payloadJson,
    })

    const responseText = await response.text()
    const completedAt = new Date().toISOString()

    if (response.ok) {
      await completeOutboundDelivery(db, {
        id: deliveryId,
        status: 'delivered',
        responseStatus: response.status,
        responseBody: responseText,
        completedAt,
        errorMessage: null,
      })

      let partnerResponse: unknown = responseText
      try {
        partnerResponse = JSON.parse(responseText)
      } catch {
        // Not JSON — keep the raw text.
      }

      return sendData(c, 200, { deliveryId, eventId, status: 'delivered', partnerStatus: response.status, partnerResponse })
    }

    await completeOutboundDelivery(db, {
      id: deliveryId,
      status: 'failed',
      responseStatus: response.status,
      responseBody: responseText,
      completedAt,
      errorMessage: `Partner responded with HTTP ${response.status}.`,
    })

    return c.json(
      {
        error: {
          code: 'PARTNER_WEBHOOK_DELIVERY_FAILED',
          message: 'Team 17 webhook delivery failed. The delivery was recorded for retry.',
          deliveryId,
          partnerStatus: response.status,
        },
      },
      502,
    )
  } catch (err) {
    const completedAt = new Date().toISOString()
    const message = err instanceof Error ? err.message : 'Network error contacting the partner webhook.'

    await completeOutboundDelivery(db, {
      id: deliveryId,
      status: 'failed',
      responseStatus: null,
      responseBody: null,
      completedAt,
      errorMessage: message,
    })

    return c.json(
      {
        error: {
          code: 'PARTNER_WEBHOOK_DELIVERY_FAILED',
          message: 'Team 17 webhook delivery failed. The delivery was recorded for retry.',
          deliveryId,
          partnerStatus: null,
        },
      },
      502,
    )
  }
})

// Assignment-5 evidence only. Never returns a secret or a request header —
// outbound_webhook_deliveries never stored either in the first place.
team17Integration.get('/integrations/team17/deliveries', async (c) => {
  const db = getDb(c.env)
  const deliveries = await listRecentOutboundDeliveries(db, PARTNER, RECENT_DELIVERIES_LIMIT)

  return sendData(
    c,
    200,
    deliveries.map((delivery) => ({
      id: delivery.id,
      eventId: delivery.eventId,
      endpoint: delivery.endpoint,
      requestPayload: JSON.parse(delivery.requestPayloadJson) as unknown,
      responseStatus: delivery.responseStatus,
      responseBody: delivery.responseBody,
      status: delivery.status,
      attemptedAt: delivery.attemptedAt,
      completedAt: delivery.completedAt,
      errorMessage: delivery.errorMessage,
    })),
  )
})
