import { Hono, type Context } from 'hono'
import type { AppEnv } from '../lib/app-env'
import type { Course, CourseStatus } from '../lib/types'
import { requireAuth, requireRole } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalNullableString, readJsonBody, requireNonEmptyString } from '../lib/validation'
import { getDb } from '../lib/db'
import { COURSE_CODE_PATTERN, MAX_COURSE_DESCRIPTION_LENGTH, MAX_COURSE_NAME_LENGTH } from '../lib/constants'
import { createCourse, findCourseById, listCourses, updateCourse, type CoursePatch } from '../repositories/courses-repository'

export const courses = new Hono<AppEnv>()

// requireAuth is applied per-route — see the comment in src/routes/sources.ts.

export class CourseUnavailableError extends Error {
  constructor(
    readonly status: 404 | 400,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Sources and questions must belong to an existing, active course.
 * Throws CourseUnavailableError (send it with sendCourseError).
 */
export async function requireActiveCourse(db: D1Database, courseId: string): Promise<Course> {
  const course = await findCourseById(db, courseId)
  if (!course) throw new CourseUnavailableError(404, `Course ${courseId} does not exist. An instructor must create it first.`)
  if (course.status !== 'active') throw new CourseUnavailableError(400, `Course ${courseId} is archived.`)
  return course
}

export function sendCourseError(c: Context<AppEnv>, err: CourseUnavailableError) {
  return sendError(c, err.status, err.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', err.message)
}

function parseName(value: unknown): string {
  const name = requireNonEmptyString(value, 'name')
  if (name.length > MAX_COURSE_NAME_LENGTH) throw new ValidationError(`name must be at most ${MAX_COURSE_NAME_LENGTH} characters.`)
  return name
}

function parseDescription(value: unknown): string | null {
  const description = optionalNullableString(value, 'description') || null
  if (description && description.length > MAX_COURSE_DESCRIPTION_LENGTH) {
    throw new ValidationError(`description must be at most ${MAX_COURSE_DESCRIPTION_LENGTH} characters.`)
  }
  return description
}

/** Active courses for everyone; instructors can add ?includeArchived=true. */
courses.get('/courses', requireAuth, async (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true' && c.get('user').role === 'instructor'
  const items = await listCourses(getDb(c.env), includeArchived)
  return sendData(c, 200, { items, count: items.length })
})

courses.get('/courses/:courseId', requireAuth, async (c) => {
  const course = await findCourseById(getDb(c.env), c.req.param('courseId') ?? '')
  if (!course || (course.status !== 'active' && c.get('user').role !== 'instructor')) {
    return sendError(c, 404, 'NOT_FOUND', 'Course not found.')
  }
  return sendData(c, 200, course)
})

courses.post('/courses', requireAuth, requireRole('instructor'), async (c) => {
  try {
    const body = await readJsonBody(c)
    const id = requireNonEmptyString(body.id, 'id')
    if (!COURSE_CODE_PATTERN.test(id)) {
      throw new ValidationError('id must be a course code of 2–32 letters, digits, "-" or "_", e.g. 1305308.')
    }
    const now = new Date().toISOString()
    const course = await createCourse(getDb(c.env), {
      id,
      name: parseName(body.name),
      description: parseDescription(body.description),
      status: 'active',
      createdBy: c.get('user').id,
      createdAt: now,
      updatedAt: now,
    })
    if (!course) return sendError(c, 409, 'CONFLICT', `Course ${id} already exists.`)
    return sendData(c, 201, course)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})

/** Rename, describe, archive or restore a course. Archiving keeps its materials and questions. */
courses.patch('/courses/:courseId', requireAuth, requireRole('instructor'), async (c) => {
  try {
    const body = await readJsonBody(c)
    const patch: CoursePatch = {}
    if (body.name !== undefined) patch.name = parseName(body.name)
    if (body.description !== undefined) patch.description = parseDescription(body.description)
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'archived') throw new ValidationError('status must be active or archived.')
      patch.status = body.status as CourseStatus
    }
    if (Object.keys(patch).length === 0) throw new ValidationError('At least one field must be provided to update.')

    const updated = await updateCourse(getDb(c.env), c.req.param('courseId') ?? '', patch, new Date().toISOString())
    if (!updated) return sendError(c, 404, 'NOT_FOUND', 'Course not found.')
    return sendData(c, 200, updated)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})
