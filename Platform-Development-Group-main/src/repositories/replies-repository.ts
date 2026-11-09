// Instructor replies to student questions, the "Ask my instructor"
// escalation, and the two question lists built on them: a student's own
// questions, and an instructor's inbox of questions that need a person.

import type { AnswerMode, InstructorReply, Question } from '../lib/types'
import type { ChunkDraft } from '../services/chunking'
import { mapQuestion, type QuestionRow } from './questions-repository'
import { createSourceWithChunksStatements, type CreateSourceInput } from './sources-repository'

interface ReplyRow {
  id: string
  question_id: string
  instructor_id: string
  content: string
  faq_source_id: string | null
  created_at: string
  read_at: string | null
}

function mapReply(row: ReplyRow): InstructorReply {
  return {
    id: row.id,
    questionId: row.question_id,
    instructorId: row.instructor_id,
    content: row.content,
    faqSourceId: row.faq_source_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

/**
 * Marks a question as needing an instructor. The first escalation time is
 * kept (so the inbox order is stable); asking again only updates the note.
 */
export async function escalateQuestion(
  db: D1Database,
  id: string,
  note: string | null,
  now: string,
): Promise<Question | null> {
  const row = await db
    .prepare(
      `UPDATE questions
       SET escalated_at = COALESCE(escalated_at, ?), escalation_note = ?, updated_at = ?
       WHERE id = ? RETURNING *`,
    )
    .bind(now, note, now, id)
    .first<QuestionRow>()
  return row ? mapQuestion(row) : null
}

export interface CreateReplyInput {
  id: string
  questionId: string
  instructorId: string
  content: string
  createdAt: string
}

/** Reply, and optionally the FAQ source made from it, are written in one D1 batch. */
export async function createReply(
  db: D1Database,
  input: CreateReplyInput,
  faq: { source: CreateSourceInput; chunks: ChunkDraft[] } | null,
): Promise<InstructorReply> {
  const faqSourceId = faq ? faq.source.id : null
  await db.batch([
    ...(faq ? createSourceWithChunksStatements(db, faq.source, faq.chunks) : []),
    db
      .prepare(
        `INSERT INTO instructor_replies (id, question_id, instructor_id, content, faq_source_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.questionId, input.instructorId, input.content, faqSourceId, input.createdAt),
  ])
  return { ...input, faqSourceId, readAt: null }
}

export async function listRepliesForQuestion(db: D1Database, questionId: string): Promise<InstructorReply[]> {
  const { results } = await db
    .prepare(`SELECT * FROM instructor_replies WHERE question_id = ? ORDER BY created_at ASC, id ASC`)
    .bind(questionId)
    .all<ReplyRow>()
  return results.map(mapReply)
}

/** Records that the student who asked has seen the replies (clears the unread badge). */
export async function markRepliesRead(db: D1Database, questionId: string, now: string): Promise<void> {
  await db
    .prepare(`UPDATE instructor_replies SET read_at = ? WHERE question_id = ? AND read_at IS NULL`)
    .bind(now, questionId)
    .run()
}

export interface StudentQuestionSummary extends Question {
  answerMode: AnswerMode | null
  replyCount: number
  unreadReplies: number
}

interface StudentQuestionRow extends QuestionRow {
  answer_mode: AnswerMode | null
  reply_count: number
  unread_replies: number
}

/** A student's own questions, newest first, with reply counts. */
export async function listStudentQuestions(
  db: D1Database,
  studentId: string,
  limit: number,
): Promise<StudentQuestionSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT q.*, a.mode AS answer_mode,
              (SELECT COUNT(*) FROM instructor_replies r WHERE r.question_id = q.id) AS reply_count,
              (SELECT COUNT(*) FROM instructor_replies r WHERE r.question_id = q.id AND r.read_at IS NULL) AS unread_replies
       FROM questions q
       LEFT JOIN answers a ON a.question_id = q.id
       WHERE q.student_id = ?
       ORDER BY q.created_at DESC
       LIMIT ?`,
    )
    .bind(studentId, limit)
    .all<StudentQuestionRow>()

  return results.map((row) => ({
    ...mapQuestion(row),
    answerMode: row.answer_mode,
    replyCount: Number(row.reply_count),
    unreadReplies: Number(row.unread_replies),
  }))
}

export type InboxReason = 'asked_instructor' | 'no_source_found' | 'failed' | 'low_rating'

/** A rating at or below this, given by the student who asked, sends the question to the inbox. */
export const LOW_RATING_THRESHOLD = 2

export interface InboxItem {
  question: Question
  answer: { id: string; mode: AnswerMode; content: string } | null
  /** Lowest rating the asking student gave the answer, or null. */
  studentRating: number | null
  reasons: InboxReason[]
  replyCount: number
}

interface InboxRow extends QuestionRow {
  answer_id: string | null
  answer_mode: AnswerMode | null
  answer_content: string | null
  student_rating: number | null
  reply_count: number
}

/**
 * Questions in a course that need a person: the student asked for an
 * instructor, the assistant found no approved source, or the student rated
 * the answer low. `openOnly` hides questions that already have a reply.
 */
export async function listInbox(
  db: D1Database,
  courseId: string,
  openOnly: boolean,
  limit: number,
): Promise<InboxItem[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT q.*, a.id AS answer_id, a.mode AS answer_mode, a.content AS answer_content,
                (SELECT MIN(f.rating) FROM answer_feedback f
                  WHERE f.answer_id = a.id AND f.user_id = q.student_id) AS student_rating,
                (SELECT COUNT(*) FROM instructor_replies r WHERE r.question_id = q.id) AS reply_count
         FROM questions q
         LEFT JOIN answers a ON a.question_id = q.id
         WHERE q.course_id = ?
       )
       WHERE (escalated_at IS NOT NULL
              OR status IN ('no_source_found', 'failed')
              OR student_rating <= ?)
         AND (? = 0 OR reply_count = 0)
       ORDER BY COALESCE(escalated_at, created_at) DESC
       LIMIT ?`,
    )
    .bind(courseId, LOW_RATING_THRESHOLD, openOnly ? 1 : 0, limit)
    .all<InboxRow>()

  return results.map((row) => {
    const question = mapQuestion(row)
    const reasons: InboxReason[] = []
    if (question.escalatedAt) reasons.push('asked_instructor')
    if (question.status === 'no_source_found') reasons.push('no_source_found')
    if (question.status === 'failed') reasons.push('failed')
    if (row.student_rating !== null && row.student_rating <= LOW_RATING_THRESHOLD) reasons.push('low_rating')
    return {
      question,
      answer:
        row.answer_id && row.answer_mode && row.answer_content !== null
          ? { id: row.answer_id, mode: row.answer_mode, content: row.answer_content }
          : null,
      studentRating: row.student_rating,
      reasons,
      replyCount: Number(row.reply_count),
    }
  })
}
