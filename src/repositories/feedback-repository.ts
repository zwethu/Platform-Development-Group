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

export async function findAnswerExists(db: D1Database, answerId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM answers WHERE id = ?`).bind(answerId).first<{ id: string }>()
  return row !== null
}

export interface CreateFeedbackInput {
  id: string
  answerId: string
  userId: string
  rating: number
  comment: string | null
  createdAt: string
}

export async function createFeedback(db: D1Database, input: CreateFeedbackInput): Promise<AnswerFeedback> {
  await db
    .prepare(
      `INSERT INTO answer_feedback (id, answer_id, user_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.answerId, input.userId, input.rating, input.comment, input.createdAt)
    .run()

  return mapRow({
    id: input.id,
    answer_id: input.answerId,
    user_id: input.userId,
    rating: input.rating,
    comment: input.comment,
    created_at: input.createdAt,
  })
}
