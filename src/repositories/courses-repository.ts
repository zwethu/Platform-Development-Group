import type { Course, CourseStatus } from '../lib/types'

interface CourseRow {
  id: string
  name: string
  description: string | null
  status: CourseStatus
  created_by: string
  created_at: string
  updated_at: string
  source_count?: number
}

export type CourseWithCounts = Course & { sourceCount: number }

function mapCourse(row: CourseRow): Course {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findCourseById(db: D1Database, id: string): Promise<Course | null> {
  const row = await db.prepare(`SELECT * FROM courses WHERE id = ?`).bind(id).first<CourseRow>()
  return row ? mapCourse(row) : null
}

/** Courses with how many approved sources each has; archived ones only when asked for. */
export async function listCourses(db: D1Database, includeArchived: boolean): Promise<CourseWithCounts[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM knowledge_sources s WHERE s.course_id = c.id AND s.status = 'approved') AS source_count
       FROM courses c
       WHERE (? = 1 OR c.status = 'active')
       ORDER BY c.status ASC, c.id ASC`,
    )
    .bind(includeArchived ? 1 : 0)
    .all<CourseRow>()
  return results.map((row) => ({ ...mapCourse(row), sourceCount: Number(row.source_count ?? 0) }))
}

/** Returns null when a course with this code already exists. */
export async function createCourse(db: D1Database, course: Course): Promise<Course | null> {
  const result = await db
    .prepare(
      `INSERT INTO courses (id, name, description, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(course.id, course.name, course.description, course.status, course.createdBy, course.createdAt, course.updatedAt)
    .run()
  return (result.meta?.changes ?? 0) > 0 ? course : null
}

export interface CoursePatch {
  name?: string
  description?: string | null
  status?: CourseStatus
}

const PATCHABLE: Record<keyof CoursePatch, string> = { name: 'name', description: 'description', status: 'status' }

export async function updateCourse(db: D1Database, id: string, patch: CoursePatch, updatedAt: string): Promise<Course | null> {
  const assignments: string[] = []
  const values: unknown[] = []
  for (const [field, column] of Object.entries(PATCHABLE) as Array<[keyof CoursePatch, string]>) {
    if (patch[field] !== undefined) {
      assignments.push(`${column} = ?`)
      values.push(patch[field])
    }
  }
  assignments.push('updated_at = ?')
  values.push(updatedAt, id)
  const row = await db
    .prepare(`UPDATE courses SET ${assignments.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first<CourseRow>()
  return row ? mapCourse(row) : null
}
