import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import type { KnowledgeSourceStatus } from '../lib/types'
import { requireAuth, requireRole } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalKeywords, optionalNullableString, readJsonBody, requireNonEmptyString } from '../lib/validation'
import { isKnowledgeSourceStatus } from '../lib/constants'
import { getDb } from '../lib/db'
import {
  archiveSource,
  createSource,
  findSourceById,
  listApprovedSourcesByCourse,
  updateSource,
  type SourcePatch,
} from '../repositories/sources-repository'

export const sources = new Hono<AppEnv>()

// requireAuth is applied per-route (not via `.use('*', ...)`) because this
// sub-app is mounted at the v1 root alongside public routes (integration
// status, the internship webhook) — a wildcard here would otherwise catch
// every path under /v1, not just this file's own routes.

sources.post('/sources', requireAuth, requireRole('instructor'), async (c) => {
  try {
    const body = await readJsonBody(c)

    const courseId = requireNonEmptyString(body.courseId, 'courseId')
    const title = requireNonEmptyString(body.title, 'title')
    const sourceType = requireNonEmptyString(body.sourceType, 'sourceType')
    const sourceUrl = optionalNullableString(body.sourceUrl, 'sourceUrl')
    const storageKey = optionalNullableString(body.storageKey, 'storageKey')
    const content = optionalNullableString(body.content, 'content')
    const keywords = optionalKeywords(body.keywords)

    let status: KnowledgeSourceStatus = 'approved'
    if (body.status !== undefined) {
      if (!isKnowledgeSourceStatus(body.status)) {
        throw new ValidationError('status must be one of draft, approved, archived.')
      }
      status = body.status
    }

    const user = c.get('user')
    const now = new Date().toISOString()

    const source = await createSource(getDb(c.env), {
      id: crypto.randomUUID(),
      courseId,
      title,
      sourceType,
      sourceUrl,
      storageKey,
      content,
      keywords,
      status,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    })

    return sendData(c, 201, source)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})

sources.patch('/sources/:id', requireAuth, requireRole('instructor'), async (c) => {
  try {
    const id = c.req.param('id')
    if (!id) return sendError(c, 400, 'VALIDATION_ERROR', 'id is required.')

    const body = await readJsonBody(c)

    const patch: SourcePatch = {}

    if (body.title !== undefined) patch.title = requireNonEmptyString(body.title, 'title')
    if (body.sourceType !== undefined) patch.sourceType = requireNonEmptyString(body.sourceType, 'sourceType')
    if (body.sourceUrl !== undefined) patch.sourceUrl = optionalNullableString(body.sourceUrl, 'sourceUrl')
    if (body.storageKey !== undefined) patch.storageKey = optionalNullableString(body.storageKey, 'storageKey')
    if (body.content !== undefined) patch.content = optionalNullableString(body.content, 'content')
    if (body.keywords !== undefined) patch.keywords = optionalKeywords(body.keywords)
    if (body.status !== undefined) {
      if (!isKnowledgeSourceStatus(body.status)) {
        throw new ValidationError('status must be one of draft, approved, archived.')
      }
      patch.status = body.status
    }

    if (Object.keys(patch).length === 0) {
      throw new ValidationError('At least one field must be provided to update.')
    }

    const db = getDb(c.env)
    const existing = await findSourceById(db, id)
    if (!existing) return sendError(c, 404, 'NOT_FOUND', 'Knowledge source not found.')

    const updated = await updateSource(db, id, patch, new Date().toISOString())
    return sendData(c, 200, updated)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})

// Soft delete / archive only — the row is never physically removed.
sources.delete('/sources/:id', requireAuth, requireRole('instructor'), async (c) => {
  const id = c.req.param('id')
  if (!id) return sendError(c, 400, 'VALIDATION_ERROR', 'id is required.')

  const db = getDb(c.env)

  const existing = await findSourceById(db, id)
  if (!existing) return sendError(c, 404, 'NOT_FOUND', 'Knowledge source not found.')

  // Idempotent: archiving an already-archived source still returns 200.
  const archived = await archiveSource(db, id, new Date().toISOString())
  return sendData(c, 200, archived)
})

sources.get('/courses/:courseId/sources', requireAuth, async (c) => {
  const courseId = c.req.param('courseId')?.trim()
  if (!courseId) {
    return sendError(c, 400, 'VALIDATION_ERROR', 'courseId is required.')
  }

  const items = await listApprovedSourcesByCourse(getDb(c.env), courseId)
  return sendData(c, 200, { items, count: items.length })
})
