// Small, dependency-free validation helpers for request bodies.

import type { Context } from 'hono'

export class ValidationError extends Error {}

export function parseJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.')
  }
  return body as Record<string, unknown>
}

export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON.')
  }
  return parseJsonObject(raw)
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} is required and cannot be empty.`)
  }
  return trimmed
}

/** Accepts a string (trimmed), or null/undefined -> null. Rejects any other type. */
export function optionalNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string or null.`)
  }
  return value.trim()
}

/**
 * `keywords` may arrive as a string array or an already-normalized string.
 * Stored consistently as a single comma-separated TEXT column.
 */
export function optionalKeywords(value: unknown): string | null {
  if (value === undefined || value === null) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (Array.isArray(value)) {
    const cleaned = value.map((item) => {
      if (typeof item !== 'string') {
        throw new ValidationError('keywords must be an array of strings or a string.')
      }
      return item.trim()
    })
    const nonEmpty = cleaned.filter((item) => item.length > 0)
    return nonEmpty.length > 0 ? nonEmpty.join(', ') : null
  }

  throw new ValidationError('keywords must be an array of strings or a string.')
}

/** Accepts an array of strings (trimmed, empties dropped); null/undefined -> []. */
export function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return []

  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings.`)
  }

  return value
    .map((item) => {
      if (typeof item !== 'string') {
        throw new ValidationError(`${field} must be an array of strings.`)
      }
      return item.trim()
    })
    .filter((item) => item.length > 0)
}
