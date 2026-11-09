import type { KnowledgeSource, KnowledgeSourceStatus, SourceChunk } from '../lib/types'
import type { ChunkDraft } from '../services/chunking'

interface SourceRow {
  id: string
  course_id: string
  title: string
  source_type: string
  source_url: string | null
  storage_key: string | null
  content: string | null
  keywords: string | null
  status: KnowledgeSourceStatus
  // Added in migration 0004; undefined when a test double omits them.
  file_name?: string | null
  segment_count?: number | null
  created_by: string
  created_at: string
  updated_at: string
}

interface ChunkRow {
  source_id: string
  position: number
  location: string | null
  content: string
}

function mapRow(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    storageKey: row.storage_key,
    content: row.content,
    keywords: row.keywords,
    status: row.status,
    fileName: row.file_name ?? null,
    segmentCount: row.segment_count ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapChunk(row: ChunkRow): SourceChunk {
  return { sourceId: row.source_id, position: row.position, location: row.location, content: row.content }
}

export type CreateSourceInput = Omit<KnowledgeSource, 'fileName' | 'segmentCount'> &
  Partial<Pick<KnowledgeSource, 'fileName' | 'segmentCount'>>

const INSERT_SOURCE_SQL = `INSERT INTO knowledge_sources
  (id, course_id, title, source_type, source_url, storage_key, content, keywords, status, created_by, created_at, updated_at, file_name, segment_count)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

function insertSourceStatement(db: D1Database, input: CreateSourceInput): D1PreparedStatement {
  return db
    .prepare(INSERT_SOURCE_SQL)
    .bind(
      input.id,
      input.courseId,
      input.title,
      input.sourceType,
      input.sourceUrl,
      input.storageKey,
      input.content,
      input.keywords,
      input.status,
      input.createdBy,
      input.createdAt,
      input.updatedAt,
      input.fileName ?? null,
      input.segmentCount ?? null,
    )
}

function withFileFields(input: CreateSourceInput): KnowledgeSource {
  return { ...input, fileName: input.fileName ?? null, segmentCount: input.segmentCount ?? null }
}

/** Inserts a source without chunks. Search then uses its `content` column directly (Team 17 webhook). */
export async function createSource(db: D1Database, input: CreateSourceInput): Promise<KnowledgeSource> {
  await insertSourceStatement(db, input).run()
  return withFileFields(input)
}

// 5 values per chunk row and D1 allows 100 bound parameters per statement.
const CHUNK_ROWS_PER_STATEMENT = 20

/** Statements that replace all of a source's chunks. Run them inside one db.batch() so it is all-or-nothing. */
export function replaceChunksStatements(db: D1Database, sourceId: string, chunks: ChunkDraft[]): D1PreparedStatement[] {
  const statements = [db.prepare(`DELETE FROM source_chunks WHERE source_id = ?`).bind(sourceId)]
  for (let i = 0; i < chunks.length; i += CHUNK_ROWS_PER_STATEMENT) {
    const rows = chunks.slice(i, i + CHUNK_ROWS_PER_STATEMENT)
    statements.push(
      db
        .prepare(
          `INSERT INTO source_chunks (id, source_id, position, location, content) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        )
        .bind(...rows.flatMap((chunk) => [crypto.randomUUID(), sourceId, chunk.position, chunk.location, chunk.content])),
    )
  }
  return statements
}

/** Source and its chunks are written in one D1 batch: a source never exists with half its text. */
export function createSourceWithChunksStatements(
  db: D1Database,
  input: CreateSourceInput,
  chunks: ChunkDraft[],
): D1PreparedStatement[] {
  // The DELETE in replaceChunksStatements is a no-op for a brand-new source; skip it.
  return [insertSourceStatement(db, input), ...replaceChunksStatements(db, input.id, chunks).slice(1)]
}

export async function createSourceWithChunks(
  db: D1Database,
  input: CreateSourceInput,
  chunks: ChunkDraft[],
): Promise<KnowledgeSource> {
  await db.batch(createSourceWithChunksStatements(db, input, chunks))
  return withFileFields(input)
}

export async function findSourceById(db: D1Database, id: string): Promise<KnowledgeSource | null> {
  const row = await db.prepare(`SELECT * FROM knowledge_sources WHERE id = ?`).bind(id).first<SourceRow>()
  return row ? mapRow(row) : null
}

export async function listApprovedSourcesByCourse(db: D1Database, courseId: string): Promise<KnowledgeSource[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM knowledge_sources
       WHERE course_id = ? AND status = 'approved'
       ORDER BY updated_at DESC, title ASC`,
    )
    .bind(courseId)
    .all<SourceRow>()

  return results.map(mapRow)
}

/** Every chunk of every approved source in a course — the search corpus for a question. */
export async function listApprovedChunksByCourse(db: D1Database, courseId: string): Promise<SourceChunk[]> {
  const { results } = await db
    .prepare(
      `SELECT c.source_id, c.position, c.location, c.content
       FROM source_chunks c
       JOIN knowledge_sources s ON s.id = c.source_id
       WHERE s.course_id = ? AND s.status = 'approved'
       ORDER BY c.source_id, c.position`,
    )
    .bind(courseId)
    .all<ChunkRow>()

  return results.map(mapChunk)
}

export async function listChunksBySource(db: D1Database, sourceId: string): Promise<SourceChunk[]> {
  const { results } = await db
    .prepare(`SELECT source_id, position, location, content FROM source_chunks WHERE source_id = ? ORDER BY position`)
    .bind(sourceId)
    .all<ChunkRow>()

  return results.map(mapChunk)
}

export interface SourcePatch {
  title?: string
  sourceType?: string
  sourceUrl?: string | null
  storageKey?: string | null
  content?: string | null
  keywords?: string | null
  status?: KnowledgeSourceStatus
}

// Fixed, explicit column whitelist — patch values are always bound
// parameters, never interpolated, so this cannot become a SQL-injection
// vector regardless of what the caller sends.
const PATCHABLE_COLUMNS: Record<keyof SourcePatch, string> = {
  title: 'title',
  sourceType: 'source_type',
  sourceUrl: 'source_url',
  storageKey: 'storage_key',
  content: 'content',
  keywords: 'keywords',
  status: 'status',
}

/**
 * Applies a patch. When `chunks` is given (the text changed), the source's
 * chunks are replaced in the same D1 batch as the update.
 */
export async function updateSource(
  db: D1Database,
  id: string,
  patch: SourcePatch,
  updatedAt: string,
  chunks?: ChunkDraft[],
): Promise<KnowledgeSource | null> {
  const assignments: string[] = []
  const values: unknown[] = []

  for (const [field, column] of Object.entries(PATCHABLE_COLUMNS) as Array<[keyof SourcePatch, string]>) {
    if (patch[field] !== undefined) {
      assignments.push(`${column} = ?`)
      values.push(patch[field])
    }
  }

  assignments.push('updated_at = ?')
  values.push(updatedAt, id)

  const update = db.prepare(`UPDATE knowledge_sources SET ${assignments.join(', ')} WHERE id = ? RETURNING *`).bind(...values)

  if (chunks === undefined) {
    const row = await update.first<SourceRow>()
    return row ? mapRow(row) : null
  }

  const [updated] = await db.batch<SourceRow>([update, ...replaceChunksStatements(db, id, chunks)])
  const row = updated?.results?.[0]
  return row ? mapRow(row) : null
}

/** Archive is idempotent: re-archiving an already-archived source just re-applies the same state. */
export async function archiveSource(db: D1Database, id: string, updatedAt: string): Promise<KnowledgeSource | null> {
  const row = await db
    .prepare(`UPDATE knowledge_sources SET status = 'archived', updated_at = ? WHERE id = ? RETURNING *`)
    .bind(updatedAt, id)
    .first<SourceRow>()

  return row ? mapRow(row) : null
}
