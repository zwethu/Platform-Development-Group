import type { Answer, AnswerMode, Citation, Question, QuestionStatus } from '../lib/types'

// Answers and citations are created and read together with their question,
// so they live in this repository rather than as separate files.

export interface QuestionRow {
  id: string
  course_id: string
  student_id: string
  question_text: string
  status: QuestionStatus
  // Added in migration 0004; undefined when a test double omits them.
  escalated_at?: string | null
  escalation_note?: string | null
  created_at: string
  updated_at: string
}

interface AnswerRow {
  id: string
  question_id: string
  content: string
  mode: AnswerMode
  no_source_found: number
  created_at: string
}

interface CitationRow {
  id: string
  answer_id: string
  source_id: string
  excerpt: string
  location: string | null
  score: number | null
  created_at: string
  source_title: string
  source_url: string | null
}

export type CitationWithSource = Citation & { sourceTitle: string; sourceUrl: string | null }

export function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    courseId: row.course_id,
    studentId: row.student_id,
    questionText: row.question_text,
    status: row.status,
    escalatedAt: row.escalated_at ?? null,
    escalationNote: row.escalation_note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAnswer(row: AnswerRow): Answer {
  return {
    id: row.id,
    questionId: row.question_id,
    content: row.content,
    mode: row.mode,
    noSourceFound: row.no_source_found === 1,
    createdAt: row.created_at,
  }
}

function mapCitation(row: CitationRow): CitationWithSource {
  return {
    id: row.id,
    answerId: row.answer_id,
    sourceId: row.source_id,
    excerpt: row.excerpt,
    location: row.location,
    score: row.score,
    createdAt: row.created_at,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
  }
}

export interface CreateQuestionInput {
  id: string
  courseId: string
  studentId: string
  questionText: string
  createdAt: string
  updatedAt: string
}

export async function createQuestion(db: D1Database, input: CreateQuestionInput): Promise<Question> {
  await db
    .prepare(
      `INSERT INTO questions (id, course_id, student_id, question_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(input.id, input.courseId, input.studentId, input.questionText, input.createdAt, input.updatedAt)
    .run()

  return {
    id: input.id,
    courseId: input.courseId,
    studentId: input.studentId,
    questionText: input.questionText,
    status: 'pending',
    escalatedAt: null,
    escalationNote: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

export async function findQuestionById(db: D1Database, id: string): Promise<Question | null> {
  const row = await db.prepare(`SELECT * FROM questions WHERE id = ?`).bind(id).first<QuestionRow>()
  return row ? mapQuestion(row) : null
}

export async function updateQuestionStatus(
  db: D1Database,
  id: string,
  status: QuestionStatus,
  updatedAt: string,
): Promise<Question | null> {
  const row = await db
    .prepare(`UPDATE questions SET status = ?, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(status, updatedAt, id)
    .first<QuestionRow>()

  return row ? mapQuestion(row) : null
}

export interface CreateAnswerWithCitationsInput {
  id: string
  questionId: string
  content: string
  mode: AnswerMode
  noSourceFound: boolean
  createdAt: string
  citations: Array<{
    id: string
    sourceId: string
    excerpt: string
    location: string | null
    score: number | null
    createdAt: string
  }>
}

/** Answer + its citations are written as one D1 batch, so an answer never exists without them. */
export async function createAnswerWithCitations(
  db: D1Database,
  input: CreateAnswerWithCitationsInput,
): Promise<{ answer: Answer; citations: Citation[] }> {
  const statements = [
    db
      .prepare(
        `INSERT INTO answers (id, question_id, content, mode, no_source_found, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.questionId, input.content, input.mode, input.noSourceFound ? 1 : 0, input.createdAt),
    ...input.citations.map((citation) =>
      db
        .prepare(
          `INSERT INTO citations (id, answer_id, source_id, excerpt, location, score, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          citation.id,
          input.id,
          citation.sourceId,
          citation.excerpt,
          citation.location,
          citation.score,
          citation.createdAt,
        ),
    ),
  ]

  await db.batch(statements)

  return {
    answer: {
      id: input.id,
      questionId: input.questionId,
      content: input.content,
      mode: input.mode,
      noSourceFound: input.noSourceFound,
      createdAt: input.createdAt,
    },
    citations: input.citations.map((citation) => ({
      id: citation.id,
      answerId: input.id,
      sourceId: citation.sourceId,
      excerpt: citation.excerpt,
      location: citation.location,
      score: citation.score,
      createdAt: citation.createdAt,
    })),
  }
}

export async function findAnswerWithCitationsByQuestionId(
  db: D1Database,
  questionId: string,
): Promise<{ answer: Answer | null; citations: CitationWithSource[] }> {
  const answerRow = await db.prepare(`SELECT * FROM answers WHERE question_id = ?`).bind(questionId).first<AnswerRow>()

  if (!answerRow) {
    return { answer: null, citations: [] }
  }

  const { results } = await db
    .prepare(
      `SELECT c.id, c.answer_id, c.source_id, c.excerpt, c.location, c.score, c.created_at,
              s.title AS source_title, s.source_url AS source_url
       FROM citations c
       JOIN knowledge_sources s ON s.id = c.source_id
       WHERE c.answer_id = ?
       ORDER BY c.created_at ASC`,
    )
    .bind(answerRow.id)
    .all<CitationRow>()

  return {
    answer: mapAnswer(answerRow),
    citations: results.map(mapCitation),
  }
}
