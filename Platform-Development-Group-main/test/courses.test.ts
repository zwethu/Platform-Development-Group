// Courses created by instructors (migration 0005), and the rule that
// sources and questions must belong to an existing, active course.
// Real SQLite with the migrations applied (helpers/sqlite-d1.ts).

import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { createSqliteD1 } from './helpers/sqlite-d1'

const INSTRUCTOR = { id: 'instr-1', role: 'instructor' }
const STUDENT = { id: 'student-a', role: 'student' }

function setup() {
  const { db, query } = createSqliteD1()
  const env = { AUTH_MODE: 'demo-headers', learning_assistant_db: db }
  const call = async (user: { id: string; role: string }, method: string, path: string, body?: unknown) => {
    const res = await app.request(
      `/v1${path}`,
      {
        method,
        headers: { 'x-user-id': user.id, 'x-user-role': user.role, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    )
    const json = (await res.json()) as { data?: any; error?: { code: string; message: string } }
    return { status: res.status, data: json.data, error: json.error }
  }
  return { call, query }
}

const NEW_COURSE = { id: '1305308', name: 'Platform Development', description: 'APIs, integration and cloud deployment.' }

describe('migration 0005', () => {
  it('turns every course ID already in use into a course, and adds CAREER', () => {
    const { query, migrateRest } = createSqliteD1({ stopBefore: '0005_courses.sql' })
    query(`INSERT INTO knowledge_sources (id, course_id, title, source_type, status, created_by, created_at, updated_at)
           VALUES ('s1', '1305308', 'Notes', 'notes', 'approved', 'i', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`)
    query(`INSERT INTO questions (id, course_id, student_id, question_text, status, created_at, updated_at)
           VALUES ('q1', 'SE101', 'st', 'What?', 'answered', '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z')`)
    migrateRest()
    expect(query('SELECT id, name, status FROM courses ORDER BY id')).toEqual([
      { id: '1305308', name: 'Platform Development', status: 'active' },
      { id: 'CAREER', name: 'Careers & internships', status: 'active' },
      { id: 'SE101', name: 'SE101', status: 'active' },
    ])
  })
})

describe('creating courses', () => {
  it('lets an instructor create a course', async () => {
    const { call } = setup()
    const res = await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({ ...NEW_COURSE, status: 'active', createdBy: 'instr-1' })
  })

  it('refuses a course code that is already taken', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    const res = await call(INSTRUCTOR, 'POST', '/courses', { ...NEW_COURSE, name: 'Other name' })
    expect(res.status).toBe(409)
    expect(res.error?.code).toBe('CONFLICT')
    expect((await call(STUDENT, 'GET', '/courses/1305308')).data.name).toBe('Platform Development')
  })

  it.each([
    ['a one-character code', { id: 'A' }],
    ['a code with spaces', { id: '1305 308' }],
    ['a code with a slash', { id: '../x' }],
    ['a code that is too long', { id: 'X'.repeat(33) }],
    ['a missing name', { name: '  ' }],
    ['a name that is too long', { name: 'n'.repeat(121) }],
    ['a description that is too long', { description: 'd'.repeat(501) }],
  ])('rejects %s', async (_label, override) => {
    const { call } = setup()
    const res = await call(INSTRUCTOR, 'POST', '/courses', { ...NEW_COURSE, ...override })
    expect(res.status).toBe(400)
  })

  it('is for instructors only', async () => {
    const { call } = setup()
    expect((await call(STUDENT, 'POST', '/courses', NEW_COURSE)).status).toBe(403)
  })
})

describe('listing and archiving courses', () => {
  it('lists active courses with their number of approved sources', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    await call(INSTRUCTOR, 'POST', '/sources', { courseId: '1305308', title: 'Week 1', sourceType: 'notes', content: 'REST basics.' })
    const res = await call(STUDENT, 'GET', '/courses')
    expect(res.data.items.map((c: any) => [c.id, c.sourceCount])).toEqual([['1305308', 1], ['CAREER', 0]])
  })

  it('hides an archived course from students but not from instructors who ask', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    const archived = await call(INSTRUCTOR, 'PATCH', '/courses/1305308', { status: 'archived' })
    expect(archived.data.status).toBe('archived')

    expect((await call(STUDENT, 'GET', '/courses')).data.items.map((c: any) => c.id)).toEqual(['CAREER'])
    expect((await call(STUDENT, 'GET', '/courses?includeArchived=true')).data.count).toBe(1)
    expect((await call(STUDENT, 'GET', '/courses/1305308')).status).toBe(404)
    expect((await call(INSTRUCTOR, 'GET', '/courses?includeArchived=true')).data.count).toBe(2)
    expect((await call(INSTRUCTOR, 'GET', '/courses/1305308')).status).toBe(200)

    const restored = await call(INSTRUCTOR, 'PATCH', '/courses/1305308', { status: 'active', name: 'Platform Dev' })
    expect(restored.data).toMatchObject({ status: 'active', name: 'Platform Dev' })
  })

  it('validates course updates', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    expect((await call(INSTRUCTOR, 'PATCH', '/courses/1305308', {})).status).toBe(400)
    expect((await call(INSTRUCTOR, 'PATCH', '/courses/1305308', { status: 'deleted' })).status).toBe(400)
    expect((await call(INSTRUCTOR, 'PATCH', '/courses/NOPE', { name: 'x' })).status).toBe(404)
    expect((await call(STUDENT, 'PATCH', '/courses/1305308', { name: 'x' })).status).toBe(403)
  })
})

describe('sources and questions need an existing, active course', () => {
  it('refuses materials for a course that does not exist', async () => {
    const { call, query } = setup()
    const res = await call(INSTRUCTOR, 'POST', '/sources', { courseId: '130538', title: 'Typo', sourceType: 'notes', content: 'x' })
    expect(res.status).toBe(404)
    expect(res.error?.message).toContain('does not exist')
    expect(query('SELECT COUNT(*) AS n FROM knowledge_sources')[0].n).toBe(0)
  })

  it('refuses questions for a course that does not exist, and stores nothing', async () => {
    const { call, query } = setup()
    const res = await call(STUDENT, 'POST', '/questions', { courseId: '130538', questionText: 'What is REST?' })
    expect(res.status).toBe(404)
    expect(query('SELECT COUNT(*) AS n FROM questions')[0].n).toBe(0)
  })

  it('refuses new materials and questions in an archived course', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    await call(INSTRUCTOR, 'PATCH', '/courses/1305308', { status: 'archived' })
    expect((await call(INSTRUCTOR, 'POST', '/sources', { courseId: '1305308', title: 'x', sourceType: 'notes' })).status).toBe(400)
    const q = await call(STUDENT, 'POST', '/questions', { courseId: '1305308', questionText: 'What is REST?' })
    expect(q.status).toBe(400)
    expect(q.error?.message).toContain('archived')
  })

  it('works end to end: create a course, add material, ask', async () => {
    const { call } = setup()
    await call(INSTRUCTOR, 'POST', '/courses', NEW_COURSE)
    await call(INSTRUCTOR, 'POST', '/sources', {
      courseId: '1305308', title: 'Week 6 slides', sourceType: 'slides', fileName: 'week6.pptx',
      segments: [{ location: 'Slide 2', text: 'Webhooks are signed with HMAC-SHA-256.' }],
    })
    const res = await call(STUDENT, 'POST', '/questions', { courseId: '1305308', questionText: 'How are webhooks signed?' })
    expect(res.status).toBe(201)
    expect(res.data.citations[0]).toMatchObject({ sourceTitle: 'Week 6 slides', location: 'Slide 2' })
  })
})
