// Route-level tests for POST /v1/answers/feedback (PRD FR-10, AC-FR-10).
//
// Uses a tiny in-memory D1 stand-in that recognizes only the statements
// feedback-repository.ts issues — not a general SQL engine. Real SQL was
// checked manually against a local D1 database (wrangler dev --local).

import { describe, expect, it } from 'vitest'
import app from '../src/index'

interface FeedbackRow {
  id: string
  answer_id: string
  user_id: string
  rating: number
  comment: string | null
  created_at: string
}

/** answers maps answerId -> the student who asked that answer's question. */
function createFeedbackDb(answers: Record<string, string>) {
  const rows: FeedbackRow[] = []

  function prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            if (normalized.startsWith('SELECT q.student_id AS student_id FROM answers')) {
              const studentId = answers[args[0] as string]
              return (studentId ? { student_id: studentId } : null) as T | null
            }
            if (normalized.startsWith('SELECT * FROM answer_feedback WHERE answer_id = ? AND user_id = ?')) {
              const [answerId, userId] = args as string[]
              const row = rows.find((r) => r.answer_id === answerId && r.user_id === userId)
              return (row ? { ...row } : null) as T | null
            }
            throw new Error(`feedback fake db: unsupported first() for: ${normalized}`)
          },
          async run() {
            if (normalized.startsWith('INSERT INTO answer_feedback')) {
              const [id, answerId, userId, rating, comment, createdAt] = args as [
                string,
                string,
                string,
                number,
                string | null,
                string,
              ]
              rows.push({ id, answer_id: answerId, user_id: userId, rating, comment, created_at: createdAt })
              return { success: true, meta: {}, results: [] }
            }
            if (normalized.startsWith('UPDATE answer_feedback SET rating = ?, comment = ? WHERE id = ?')) {
              const [rating, comment, id] = args as [number, string | null, string]
              const row = rows.find((r) => r.id === id)
              if (row) {
                row.rating = rating
                row.comment = comment
              }
              return { success: true, meta: {}, results: [] }
            }
            throw new Error(`feedback fake db: unsupported run() for: ${normalized}`)
          },
        }
      },
    }
  }

  return { env: { AUTH_MODE: 'demo-headers', learning_assistant_db: { prepare } as unknown as D1Database }, rows }
}

function post(env: object, userId: string, role: string, body: unknown) {
  return app.request(
    '/v1/answers/feedback',
    {
      method: 'POST',
      headers: { 'x-user-id': userId, 'x-user-role': role, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  )
}

describe('POST /v1/answers/feedback — authorization', () => {
  it('lets the asking student rate their own answer (201)', async () => {
    const { env, rows } = createFeedbackDb({ 'ans-1': 'student-a' })
    const res = await post(env, 'student-a', 'student', { answerId: 'ans-1', rating: 5 })

    expect(res.status).toBe(201)
    expect(rows).toHaveLength(1)
  })

  it('forbids a student from rating another student\'s answer (403) and stores nothing', async () => {
    const { env, rows } = createFeedbackDb({ 'ans-1': 'student-a' })
    const res = await post(env, 'student-b', 'student', { answerId: 'ans-1', rating: 1 })

    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    expect(rows).toHaveLength(0)
  })

  it('lets an instructor rate any answer', async () => {
    const { env } = createFeedbackDb({ 'ans-1': 'student-a' })
    const res = await post(env, 'instr-1', 'instructor', { answerId: 'ans-1', rating: 4 })

    expect(res.status).toBe(201)
  })

  it('returns 404 for an unknown answer', async () => {
    const { env } = createFeedbackDb({})
    const res = await post(env, 'student-a', 'student', { answerId: 'missing', rating: 3 })

    expect(res.status).toBe(404)
  })
})

describe('POST /v1/answers/feedback — one changeable rating per user (FR-10)', () => {
  it('updates the existing rating instead of adding a second row (200)', async () => {
    const { env, rows } = createFeedbackDb({ 'ans-1': 'student-a' })

    const first = await post(env, 'student-a', 'student', { answerId: 'ans-1', rating: 5, comment: 'great' })
    const firstBody = (await first.json()) as { data: { id: string } }
    const second = await post(env, 'student-a', 'student', { answerId: 'ans-1', rating: 2 })
    const secondBody = (await second.json()) as { data: { id: string; rating: number; comment: string | null } }

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rating: 2, comment: null })
    expect(secondBody.data).toMatchObject({ id: firstBody.data.id, rating: 2, comment: null })
  })

  it('rejects a comment longer than 500 characters before touching the database', async () => {
    const { env, rows } = createFeedbackDb({ 'ans-1': 'student-a' })
    const res = await post(env, 'student-a', 'student', { answerId: 'ans-1', rating: 3, comment: 'x'.repeat(501) })

    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
  })
})
