// Minimal, purpose-built D1Database test double for the internship
// webhook route's idempotency logic — NOT a general SQL engine. It
// recognizes only the exact statement shapes issued by
// received-events-repository.ts and sources-repository.ts's
// createSource(), which is all that route touches.
//
// Real SQL behavior (foreign keys, CHECK constraints, RETURNING, etc.) is
// verified separately against a real local D1 database — see the manual
// test procedure in README's "Team 17 Integration" section.

interface FakeRow {
  [key: string]: unknown
}

export function createFakeD1() {
  const receivedEvents = new Map<string, FakeRow>()
  const knowledgeSources: FakeRow[] = []
  const outboundDeliveries = new Map<string, FakeRow>()

  function prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            if (normalized.startsWith('SELECT event_id FROM received_events')) {
              const [eventId] = args as [string]
              return (receivedEvents.get(eventId) ?? null) as T | null
            }
            throw new Error(`fake-d1: unsupported first() for: ${normalized}`)
          },
          async all<T>(): Promise<{ results: T[] }> {
            if (normalized.startsWith('SELECT * FROM outbound_webhook_deliveries')) {
              const [partner, limit] = args as [string, number]
              const results = Array.from(outboundDeliveries.values())
                .filter((row) => row.partner === partner)
                .sort((a, b) => (b.attempted_at as string).localeCompare(a.attempted_at as string))
                .slice(0, limit)
              return { results: results as T[] }
            }
            throw new Error(`fake-d1: unsupported all() for: ${normalized}`)
          },
          async run() {
            if (normalized.startsWith('INSERT INTO received_events')) {
              const [eventId, eventType, source, occurredAt, receivedAt, payloadJson] = args as string[]
              receivedEvents.set(eventId, {
                event_id: eventId,
                event_type: eventType,
                source,
                occurred_at: occurredAt,
                received_at: receivedAt,
                payload_json: payloadJson,
                processing_status: 'received',
              })
              return { success: true, meta: {}, results: [] }
            }

            if (normalized.startsWith('UPDATE received_events SET processing_status')) {
              const [status, eventId] = args as string[]
              const row = receivedEvents.get(eventId)
              if (row) row.processing_status = status
              return { success: true, meta: {}, results: [] }
            }

            if (normalized.startsWith('INSERT INTO knowledge_sources')) {
              const [
                id,
                courseId,
                title,
                sourceType,
                sourceUrl,
                storageKey,
                content,
                keywords,
                status,
                createdBy,
                createdAt,
                updatedAt,
              ] = args as string[]
              knowledgeSources.push({
                id,
                course_id: courseId,
                title,
                source_type: sourceType,
                source_url: sourceUrl,
                storage_key: storageKey,
                content,
                keywords,
                status,
                created_by: createdBy,
                created_at: createdAt,
                updated_at: updatedAt,
              })
              return { success: true, meta: {}, results: [] }
            }

            if (normalized.startsWith('INSERT INTO outbound_webhook_deliveries')) {
              const [id, partner, eventId, endpoint, requestPayloadJson, attemptedAt] = args as string[]
              outboundDeliveries.set(id, {
                id,
                partner,
                event_id: eventId,
                endpoint,
                request_payload_json: requestPayloadJson,
                response_status: null,
                response_body: null,
                status: 'pending',
                attempted_at: attemptedAt,
                completed_at: null,
                error_message: null,
              })
              return { success: true, meta: {}, results: [] }
            }

            if (normalized.startsWith('UPDATE outbound_webhook_deliveries SET status')) {
              const [status, responseStatus, responseBody, completedAt, errorMessage, id] = args as [
                string,
                number | null,
                string | null,
                string,
                string | null,
                string,
              ]
              const row = outboundDeliveries.get(id)
              if (row) {
                row.status = status
                row.response_status = responseStatus
                row.response_body = responseBody
                row.completed_at = completedAt
                row.error_message = errorMessage
              }
              return { success: true, meta: {}, results: [] }
            }

            throw new Error(`fake-d1: unsupported run() for: ${normalized}`)
          },
        }
      },
    }
  }

  return {
    db: { prepare } as unknown as D1Database,
    _inspect: { receivedEvents, knowledgeSources, outboundDeliveries },
  }
}
