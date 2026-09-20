import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import type { AuthUser, Question, QuestionStatus } from '../lib/types'
import { requireAuth, requireRole } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, readJsonBody, requireNonEmptyString } from '../lib/validation'
import { getDb } from '../lib/db'
import { findFallbackMatches } from '../services/fallback-search-service'
import { listApprovedSourcesByCourse } from '../repositories/sources-repository'
import {
  createAnswerWithCitations,
  createQuestion,
  findAnswerWithCitationsByQuestionId,
  findQuestionById,
  updateQuestionStatus,
} from '../repositories/questions-repository'

export const questions = new Hono<AppEnv>()

questions.use('*', requireAuth)

const NO_SOURCE_MESSAGE =
  'I could not find an answer in the approved materials for this course. Please check with your instructor.'

const FALLBACK_NOTE =
  'This is a deterministic keyword search over approved course materials, not an AI-generated explanation.'

/** Instructors can read any question; a student may only read their own. */
export function canViewQuestion(user: AuthUser, question: Question): boolean {
  return user.role === 'instructor' || question.studentId === user.id
}

questions.post('/questions', requireRole('student'), async (c) => {
  try {
    const body = await readJsonBody(c)
    const courseId = requireNonEmptyString(body.courseId, 'courseId')
    const questionText = requireNonEmptyString(body.questionText, 'questionText')

    const user = c.get('user')
    const db = getDb(c.env)
    const now = new Date().toISOString()

    const question = await createQuestion(db, {
      id: crypto.randomUUID(),
      courseId,
      studentId: user.id,
      questionText,
      createdAt: now,
      updatedAt: now,
    })

    const approvedSources = await listApprovedSourcesByCourse(db, courseId)
    const matches = findFallbackMatches(approvedSources, questionText)
    const noSourceFound = matches.length === 0

    const answerContent = noSourceFound
      ? NO_SOURCE_MESSAGE
      : [
          'Based on the approved course materials, the following source(s) appear relevant to your question:',
          '',
          ...matches.map((match, index) => `${index + 1}. ${match.source.title} — "${match.excerpt}"`),
        ].join('\n')

    const answerCreatedAt = new Date().toISOString()

    const { answer, citations } = await createAnswerWithCitations(db, {
      id: crypto.randomUUID(),
      questionId: question.id,
      content: answerContent,
      mode: 'fallback',
      noSourceFound,
      createdAt: answerCreatedAt,
      citations: matches.map((match) => ({
        id: crypto.randomUUID(),
        sourceId: match.source.id,
        excerpt: match.excerpt,
        location: null,
        score: match.score,
        createdAt: answerCreatedAt,
      })),
    })

    const finalStatus: QuestionStatus = noSourceFound ? 'no_source_found' : 'answered'
    const updatedQuestion = await updateQuestionStatus(db, question.id, finalStatus, new Date().toISOString())

    return sendData(c, 201, {
      question: updatedQuestion ?? question,
      answer,
      citations,
      note: FALLBACK_NOTE,
    })
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})

questions.get('/questions/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) return sendError(c, 400, 'VALIDATION_ERROR', 'id is required.')

  const db = getDb(c.env)

  const question = await findQuestionById(db, id)
  if (!question) return sendError(c, 404, 'NOT_FOUND', 'Question not found.')

  const user = c.get('user')
  if (!canViewQuestion(user, question)) {
    return sendError(c, 403, 'FORBIDDEN', 'You do not have access to this question.')
  }

  const { answer, citations } = await findAnswerWithCitationsByQuestionId(db, question.id)

  return sendData(c, 200, { question, answer, citations })
})
