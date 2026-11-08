// Structured JSON logging (PRD NFR-11, Week 12 lab task 1).
//
// One JSON object per line via console.log, which Workers Logs / `wrangler tail`
// keep and can filter by field. Every line for a request carries its
// correlationId, so one failing request can be followed end to end.
//
// Rule: question text, answer text and source content are NEVER logged —
// only ids, lengths, counts, and outcomes.

export type LogLevel = 'info' | 'warn' | 'error'

export const SERVICE_NAME = 'learning-assistant'

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, service: SERVICE_NAME, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
