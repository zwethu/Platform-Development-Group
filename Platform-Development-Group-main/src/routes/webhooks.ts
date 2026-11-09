import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalNullableString, optionalStringArray, requireNonEmptyString } from '../lib/validation'
import { verifyWebhookSignature } from '../lib/webhook-signature'
import { getDb } from '../lib/db'
import { createSource } from '../repositories/sources-repository'
import { findReceivedEventById, insertReceivedEvent, markReceivedEventStatus } from '../repositories/received-events-repository'

/**
 * Inbound webhook receiver for Team 17 (Internship). Authenticated by an
 * HMAC-SHA-256 signature (X-Webhook-Signature) over the raw request body,
 * not the temporary x-user-id/x-user-role headers the rest of the API
 * uses — those are for human callers; this is a service-to-service
 * contract. See README's "Team 17 Integration" section.
 *
 * This event shape is a provisional development contract, pending
 * confirmation from Team 17.
 */
export const webhooks = new Hono<AppEnv>()

const EXPECTED_EVENT_TYPE = 'internship.opportunity.published'
const EXPECTED_SOURCE = 'team-17-internship'
const CAREER_COURSE_ID = 'CAREER'

webhooks.post('/webhooks/internship', async (c) => {
  const secret = c.env.INTERNSHIP_WEBHOOK_SECRET
  if (!secret) {
    return sendError(c, 503, 'CONFIGURATION_ERROR', 'This webhook receiver is not configured yet.')
  }

  // Signature is verified over the exact raw body — never re-parse/
  // re-serialize JSON before this check.
  const rawBody = await c.req.text()
  const signature = c.req.header('X-Webhook-Signature')
  const signatureValid = await verifyWebhookSignature(secret, rawBody, signature)

  if (!signatureValid) {
    return sendError(c, 401, 'UNAUTHORIZED', 'Invalid or missing webhook signature.')
  }

  try {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new ValidationError('Request body must be valid JSON.')
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ValidationError('Request body must be a JSON object.')
    }
    const body = parsed as Record<string, unknown>

    const eventId = requireNonEmptyString(body.eventId, 'eventId')

    const type = requireNonEmptyString(body.type, 'type')
    if (type !== EXPECTED_EVENT_TYPE) {
      throw new ValidationError(`type must be "${EXPECTED_EVENT_TYPE}".`)
    }

    const eventSource = requireNonEmptyString(body.source, 'source')
    if (eventSource !== EXPECTED_SOURCE) {
      throw new ValidationError(`source must be "${EXPECTED_SOURCE}".`)
    }

    requireNonEmptyString(body.subject, 'subject')
    const occurredAt = requireNonEmptyString(body.occurredAt, 'occurredAt')

    if (typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) {
      throw new ValidationError('data must be an object.')
    }
    const data = body.data as Record<string, unknown>

    const opportunityId = requireNonEmptyString(data.opportunityId, 'data.opportunityId')
    const title = requireNonEmptyString(data.title, 'data.title')
    const companyName = requireNonEmptyString(data.companyName, 'data.companyName')
    const applicationDeadline = requireNonEmptyString(data.applicationDeadline, 'data.applicationDeadline')
    const url = requireNonEmptyString(data.url, 'data.url')
    const description = optionalNullableString(data.description, 'data.description')
    const requirements = optionalStringArray(data.requirements, 'data.requirements')

    const db = getDb(c.env)

    const alreadyReceived = await findReceivedEventById(db, eventId)
    if (alreadyReceived) {
      return sendData(c, 200, { eventId, status: 'duplicate', processed: false, duplicate: true })
    }

    const receivedAt = new Date().toISOString()

    try {
      await insertReceivedEvent(db, {
        eventId,
        eventType: type,
        source: eventSource,
        occurredAt,
        receivedAt,
        payloadJson: rawBody,
      })
    } catch (err) {
      console.error('Failed to record inbound internship webhook event', err)
      return sendError(c, 500, 'INTERNAL_ERROR', 'Something went wrong while processing the event.')
    }

    try {
      const titleWords = title
        .split(/\s+/)
        .map((word) => word.trim())
        .filter(Boolean)

      const keywords = ['internship', opportunityId, companyName, ...titleWords, ...requirements].join(', ')

      const contentParts = [
        `${companyName} is hiring for this internship opportunity.`,
        description,
        requirements.length > 0 ? `Requirements: ${requirements.join(', ')}.` : null,
        `Application deadline: ${applicationDeadline}.`,
      ].filter((part): part is string => Boolean(part))

      const now = new Date().toISOString()

      const source = await createSource(db, {
        id: crypto.randomUUID(),
        courseId: CAREER_COURSE_ID,
        title: `Internship: ${title}`,
        sourceType: 'internship_opportunity',
        sourceUrl: url,
        storageKey: null,
        content: contentParts.join(' '),
        keywords,
        status: 'approved',
        fileName: null,
        segmentCount: null,
        createdBy: EXPECTED_SOURCE,
        createdAt: now,
        updatedAt: now,
      })

      await markReceivedEventStatus(db, eventId, 'processed')

      return sendData(c, 202, { eventId, status: 'accepted', knowledgeSourceId: source.id })
    } catch (err) {
      console.error('Failed to process inbound internship webhook event', err)
      try {
        await markReceivedEventStatus(db, eventId, 'failed')
      } catch (markErr) {
        console.error('Failed to mark internship webhook event as failed', markErr)
      }
      return sendError(c, 500, 'INTERNAL_ERROR', 'Something went wrong while processing the event.')
    }
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})
