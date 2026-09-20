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

            throw new Error(`fake-d1: unsupported run() for: ${normalized}`)
          },
        }
      },
    }
  }

  return {
    db: { prepare } as unknown as D1Database,
    _inspect: { receivedEvents, knowledgeSources },
  }
}
