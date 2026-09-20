import type { KnowledgeSource, KnowledgeSourceStatus } from '../lib/types'

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
  created_by: string
  created_at: string
  updated_at: string
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
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type CreateSourceInput = KnowledgeSource

export async function createSource(db: D1Database, input: CreateSourceInput): Promise<KnowledgeSource> {
  await db
    .prepare(
      `INSERT INTO knowledge_sources
        (id, course_id, title, source_type, source_url, storage_key, content, keywords, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
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
    )
    .run()

  return { ...input }
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

export async function updateSource(
  db: D1Database,
  id: string,
  patch: SourcePatch,
  updatedAt: string,
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

  const row = await db
    .prepare(`UPDATE knowledge_sources SET ${assignments.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first<SourceRow>()

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
