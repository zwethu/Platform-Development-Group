import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import type { KnowledgeSourceStatus } from '../lib/types'
import { requireAuth, requireRole } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalKeywords, optionalNullableString, readJsonBody, requireNonEmptyString } from '../lib/validation'
import { isKnowledgeSourceStatus } from '../lib/constants'
import { getDb } from '../lib/db'
import {
  ALLOWED_FILE_EXTENSIONS,
  MAX_CHUNKS_PER_SOURCE,
  MAX_FILE_NAME_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_SEGMENTS,
  MAX_SOURCE_TEXT_CHARS,
  chunkSegments,
  fileExtension,
  type ChunkDraft,
  type Segment,
} from '../services/chunking'
import {
  archiveSource,
  createSourceWithChunks,
  findSourceById,
  listApprovedSourcesByCourse,
  listChunksBySource,
  updateSource,
  type SourcePatch,
} from '../repositories/sources-repository'

export const sources = new Hono<AppEnv>()

// requireAuth is applied per-route (not via `.use('*', ...)`) because this
// sub-app is mounted at the v1 root alongside public routes (integration
// status, the internship webhook) — a wildcard here would otherwise catch
// every path under /v1, not just this file's own routes.

function textChunks(content: string | null): ChunkDraft[] {
  if (content !== null && content.length > MAX_SOURCE_TEXT_CHARS) {
    throw new ValidationError(`content must be at most ${MAX_SOURCE_TEXT_CHARS} characters.`)
  }
  return content ? chunkSegments([{ location: null, text: content }]) : []
}

/**
 * Validates an uploaded file's extracted text. The file itself never reaches
 * the server: the instructor's browser reads the PDF/PPTX/DOCX and sends
 * { fileName, segments: [{ location: "Slide 3", text }] }.
 */
function parseUpload(body: Record<string, unknown>): { fileName: string; segments: Segment[]; chunks: ChunkDraft[] } {
  const fileName = requireNonEmptyString(body.fileName, 'fileName')
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    throw new ValidationError(`fileName must be at most ${MAX_FILE_NAME_LENGTH} characters.`)
  }
  if (!(ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(fileName))) {
    throw new ValidationError(`Only ${ALLOWED_FILE_EXTENSIONS.map((e) => `.${e}`).join(', ')} files can be uploaded.`)
  }

  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    throw new ValidationError('segments must be a non-empty array of { location, text }.')
  }
  if (body.segments.length > MAX_SEGMENTS) {
    throw new ValidationError(`A file can have at most ${MAX_SEGMENTS} pages, slides or sections.`)
  }

  let totalChars = 0
  const segments = body.segments.map((raw, i): Segment => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new ValidationError(`segments[${i}] must be an object.`)
    }
    const { location, text } = raw as Record<string, unknown>
    if (typeof text !== 'string') throw new ValidationError(`segments[${i}].text must be a string.`)
    const label = optionalNullableString(location, `segments[${i}].location`)
    if (label !== null && label.length > MAX_LOCATION_LENGTH) {
      throw new ValidationError(`segments[${i}].location must be at most ${MAX_LOCATION_LENGTH} characters.`)
    }
    totalChars += text.length
    return { location: label || null, text }
  })

  if (totalChars > MAX_SOURCE_TEXT_CHARS) {
    throw new ValidationError(
      `The file's text is too long (${totalChars} characters; the limit is ${MAX_SOURCE_TEXT_CHARS}). Split it into smaller files.`,
    )
  }

  const chunks = chunkSegments(segments)
  if (chunks.length === 0) {
    throw new ValidationError(
      'No text was found in the file. Scanned PDFs and slides that are only pictures cannot be searched.',
    )
  }
  if (chunks.length > MAX_CHUNKS_PER_SOURCE) {
    throw new ValidationError(`The file is too large (${chunks.length} passages; the limit is ${MAX_CHUNKS_PER_SOURCE}). Split it into smaller files.`)
  }

  return { fileName, segments, chunks }
}

sources.post('/sources', requireAuth, requireRole('instructor'), async (c) => {
  try {
    const body = await readJsonBody(c)

    const courseId = requireNonEmptyString(body.courseId, 'courseId')
    const title = requireNonEmptyString(body.title, 'title')
    const sourceType = requireNonEmptyString(body.sourceType, 'sourceType')
    const sourceUrl = optionalNullableString(body.sourceUrl, 'sourceUrl')
    const storageKey = optionalNullableString(body.storageKey, 'storageKey')
    const keywords = optionalKeywords(body.keywords)

    let status: KnowledgeSourceStatus = 'approved'
    if (body.status !== undefined) {
      if (!isKnowledgeSourceStatus(body.status)) {
        throw new ValidationError('status must be one of draft, approved, archived.')
      }
      status = body.status
    }

    const isUpload = body.segments !== undefined || body.fileName !== undefined
    if (isUpload && body.content !== undefined && body.content !== null) {
      throw new ValidationError('Send either content (typed text) or fileName and segments (an uploaded file), not both.')
    }

    const upload = isUpload ? parseUpload(body) : null
    const content = upload ? null : optionalNullableString(body.content, 'content')
    const chunks = upload ? upload.chunks : textChunks(content)

    const user = c.get('user')
    const now = new Date().toISOString()

    const source = await createSourceWithChunks(
      getDb(c.env),
      {
        id: crypto.randomUUID(),
        courseId,
        title,
        sourceType,
        sourceUrl,
        storageKey,
        content,
        keywords,
        status,
        fileName: upload?.fileName ?? null,
        segmentCount: upload?.segments.length ?? null,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      },
      chunks,
    )

    return sendData(c, 201, { ...source, chunkCount: chunks.length })
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

    if (patch.content !== undefined && existing.fileName) {
      throw new ValidationError(
        'This source was uploaded from a file, so its text cannot be edited here. Archive it and upload the new version.',
      )
    }

    // Changing the text re-splits it into chunks, in the same batch as the update.
    const chunks = patch.content !== undefined ? textChunks(patch.content) : undefined
    const updated = await updateSource(db, id, patch, new Date().toISOString(), chunks)
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

/** The passages a source was split into, with their page/slide labels: lets people check what was extracted. */
sources.get('/sources/:id/chunks', requireAuth, async (c) => {
  const id = c.req.param('id') ?? ''
  const db = getDb(c.env)

  const source = await findSourceById(db, id)
  // Students only see approved materials, the same rule as the course list.
  if (!source || (source.status !== 'approved' && c.get('user').role !== 'instructor')) {
    return sendError(c, 404, 'NOT_FOUND', 'Knowledge source not found.')
  }

  const items = await listChunksBySource(db, id)
  return sendData(c, 200, {
    source: { id: source.id, title: source.title, fileName: source.fileName, segmentCount: source.segmentCount },
    items: items.map(({ position, location, content }) => ({ position, location, content })),
    count: items.length,
  })
})

sources.get('/courses/:courseId/sources', requireAuth, async (c) => {
  const courseId = c.req.param('courseId')?.trim()
  if (!courseId) {
    return sendError(c, 400, 'VALIDATION_ERROR', 'courseId is required.')
  }

  const items = await listApprovedSourcesByCourse(getDb(c.env), courseId)
  return sendData(c, 200, { items, count: items.length })
})
