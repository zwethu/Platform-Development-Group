import type { ReceivedEventStatus } from '../lib/types'

interface ReceivedEventIdRow {
  event_id: string
}

export async function findReceivedEventById(db: D1Database, eventId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT event_id FROM received_events WHERE event_id = ?`)
    .bind(eventId)
    .first<ReceivedEventIdRow>()

  return row !== null
}

export interface InsertReceivedEventInput {
  eventId: string
  eventType: string
  source: string
  occurredAt: string
  receivedAt: string
  payloadJson: string
}

/** Inserted with processing_status = 'received' (the schema default, set explicitly here for clarity). */
export async function insertReceivedEvent(db: D1Database, input: InsertReceivedEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO received_events
        (event_id, event_type, source, occurred_at, received_at, payload_json, processing_status)
       VALUES (?, ?, ?, ?, ?, ?, 'received')`,
    )
    .bind(input.eventId, input.eventType, input.source, input.occurredAt, input.receivedAt, input.payloadJson)
    .run()
}

export async function markReceivedEventStatus(
  db: D1Database,
  eventId: string,
  status: ReceivedEventStatus,
): Promise<void> {
  await db
    .prepare(`UPDATE received_events SET processing_status = ? WHERE event_id = ?`)
    .bind(status, eventId)
    .run()
}
