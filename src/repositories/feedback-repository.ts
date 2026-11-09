import type { AnswerFeedback } from '../lib/types'

interface FeedbackRow {
  id: string
  answer_id: string
  user_id: string
  rating: number
  comment: string | null
  created_at: string
}

function mapRow(row: FeedbackRow): AnswerFeedback {
  return {
    id: row.id,
    answerId: row.answer_id,
    userId: row.user_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  }
}

/**
 * Looks up an answer together with the student who asked its question, so
 * the caller can apply the same "own question or instructor" rule as
 * GET /v1/questions/:id. Returns null when the answer does not exist.
 */
export async function findAnswerOwner(db: D1Database, answerId: string): Promise<{ studentId: string } | null> {
  const row = await db
    .prepare(
      `SELECT q.student_id AS student_id
       FROM answers a JOIN questions q ON q.id = a.question_id
       WHERE a.id = ?`,
    )
    .bind(answerId)
    .first<{ student_id: string }>()
  return row ? { studentId: row.student_id } : null
}

export interface UpsertFeedbackInput {
  id: string
  answerId: string
  userId: string
  rating: number
  comment: string | null
  createdAt: string
}

/**
 * PRD FR-10: one feedback rating per user per answer, which the user may
 * change. If this user already rated the answer, their existing row is
 * updated in place (keeping its id and created_at); otherwise a new row is
 * inserted. `created` tells the route whether to answer 201 or 200.
 */
export async function upsertFeedback(
  db: D1Database,
  input: UpsertFeedbackInput,
): Promise<{ feedback: AnswerFeedback; created: boolean }> {
  const existing = await db
    .prepare(
      `SELECT * FROM answer_feedback
       WHERE answer_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(input.answerId, input.userId)
    .first<FeedbackRow>()

  if (existing) {
    await db
      .prepare(`UPDATE answer_feedback SET rating = ?, comment = ? WHERE id = ?`)
      .bind(input.rating, input.comment, existing.id)
      .run()
    return {
      feedback: mapRow({ ...existing, rating: input.rating, comment: input.comment }),
      created: false,
    }
  }

  await db
    .prepare(
      `INSERT INTO answer_feedback (id, answer_id, user_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.answerId, input.userId, input.rating, input.comment, input.createdAt)
    .run()

  return {
    feedback: mapRow({
      id: input.id,
      answer_id: input.answerId,
      user_id: input.userId,
      rating: input.rating,
      comment: input.comment,
      created_at: input.createdAt,
    }),
    created: true,
  }
}
