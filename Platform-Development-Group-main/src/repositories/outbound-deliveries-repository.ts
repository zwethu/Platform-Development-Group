// D1 access for the outbound_webhook_deliveries ledger (Assignment 5).
// Every column is bound as a parameter — never interpolated — so this
// cannot become a SQL-injection vector regardless of what a caller sends.
// Never pass a secret or request header into any of these inputs.

export type OutboundDeliveryStatus = 'pending' | 'delivered' | 'failed'

export interface OutboundDelivery {
  id: string
  partner: string
  eventId: string
  endpoint: string
  requestPayloadJson: string
  responseStatus: number | null
  responseBody: string | null
  status: OutboundDeliveryStatus
  attemptedAt: string
  completedAt: string | null
  errorMessage: string | null
}

interface DeliveryRow {
  id: string
  partner: string
  event_id: string
  endpoint: string
  request_payload_json: string
  response_status: number | null
  response_body: string | null
  status: OutboundDeliveryStatus
  attempted_at: string
  completed_at: string | null
  error_message: string | null
}

function mapRow(row: DeliveryRow): OutboundDelivery {
  return {
    id: row.id,
    partner: row.partner,
    eventId: row.event_id,
    endpoint: row.endpoint,
    requestPayloadJson: row.request_payload_json,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    status: row.status,
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  }
}

export interface InsertOutboundDeliveryInput {
  id: string
  partner: string
  eventId: string
  endpoint: string
  requestPayloadJson: string
  attemptedAt: string
}

/** Inserted with status = 'pending' before the outbound call is made. */
export async function insertOutboundDelivery(db: D1Database, input: InsertOutboundDeliveryInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO outbound_webhook_deliveries
        (id, partner, event_id, endpoint, request_payload_json, status, attempted_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(input.id, input.partner, input.eventId, input.endpoint, input.requestPayloadJson, input.attemptedAt)
    .run()
}

export interface CompleteOutboundDeliveryInput {
  id: string
  status: OutboundDeliveryStatus
  responseStatus: number | null
  responseBody: string | null
  completedAt: string
  errorMessage: string | null
}

export async function completeOutboundDelivery(db: D1Database, input: CompleteOutboundDeliveryInput): Promise<void> {
  await db
    .prepare(
      `UPDATE outbound_webhook_deliveries
       SET status = ?, response_status = ?, response_body = ?, completed_at = ?, error_message = ?
       WHERE id = ?`,
    )
    .bind(input.status, input.responseStatus, input.responseBody, input.completedAt, input.errorMessage, input.id)
    .run()
}

export async function listRecentOutboundDeliveries(
  db: D1Database,
  partner: string,
  limit: number,
): Promise<OutboundDelivery[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM outbound_webhook_deliveries
       WHERE partner = ?
       ORDER BY attempted_at DESC
       LIMIT ?`,
    )
    .bind(partner, limit)
    .all<DeliveryRow>()

  return results.map(mapRow)
}
