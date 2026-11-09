import { Hono, type Context } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { requireAuth, requireRole } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalNullableString, parseJsonObject, requireNonEmptyString } from '../lib/validation'
import { getDb } from '../lib/db'
import {
  MAX_ESCALATION_NOTE_LENGTH,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_REPLY_LENGTH,
  MIN_QUESTION_LENGTH,
  QUESTION_LIST_LIMIT,
} from '../lib/constants'
import { chunkSegments } from '../services/chunking'
import { findQuestionById } from '../repositories/questions-repository'
import {
  createReply,
  escalateQuestion,
  listInbox,
  listStudentQuestions,
} from '../repositories/replies-repository'

export const replies = new Hono<AppEnv>()

// requireAuth is applied per-route — see the comment in src/routes/sources.ts.

/** Like readJsonBody, but an empty body counts as {} (the escalation note is optional). */
async function readOptionalJsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const text = await c.req.text()
  if (!text.trim()) return {}
  try {
    return parseJsonObject(JSON.parse(text))
  } catch (err) {
    if (err instanceof ValidationError) throw err
    throw new ValidationError('Request body must be valid JSON.')
  }
}

/** "Ask my instructor": only the student who asked the question can escalate it. */
replies.post('/questions/:id/escalate', requireAuth, requireRole('student'), async (c) => {
  try {
    const body = await readOptionalJsonBody(c)
    const note = optionalNullableString(body.note, 'note') || null
    if (note !== null && note.length > MAX_ESCALATION_NOTE_LENGTH) {
      throw new ValidationError(`note must be at most ${MAX_ESCALATION_NOTE_LENGTH} characters.`)
    }

    const db = getDb(c.env)
    const question = await findQuestionById(db, c.req.param('id') ?? '')
    if (!question) return sendError(c, 404, 'NOT_FOUND', 'Question not found.')
    if (question.studentId !== c.get('user').id) {
      return sendError(c, 403, 'FORBIDDEN', 'You can only ask an instructor about your own questions.')
    }

    const updated = await escalateQuestion(db, question.id, note, new Date().toISOString())
    return sendData(c, 200, updated)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})

/**
 * An instructor answers a question in their own words. With
 * `addToSources: true` the reply is also saved as an approved FAQ source in
 * the question's course, so later students get it as a cited AI answer.
 * The FAQ never contains the student's ID; `faqQuestion` lets the instructor
 * reword the question (for example to remove personal details) first.
 */
replies.post('/questions/:id/replies', requireAuth, requireRole('instructor'), async (c) => {
  try {
    const body = await readOptionalJsonBody(c)
    const content = requireNonEmptyString(body.content, 'content')
    if (content.length > MAX_REPLY_LENGTH) {
      throw new ValidationError(`content must be at most ${MAX_REPLY_LENGTH} characters.`)
    }
    if (body.addToSources !== undefined && typeof body.addToSources !== 'boolean') {
      throw new ValidationError('addToSources must be true or false.')
    }

    const db = getDb(c.env)
    const question = await findQuestionById(db, c.req.param('id') ?? '')
    if (!question) return sendError(c, 404, 'NOT_FOUND', 'Question not found.')

    const user = c.get('user')
    const now = new Date().toISOString()
    const replyId = crypto.randomUUID()

    let faq = null
    if (body.addToSources === true) {
      const faqQuestion =
        body.faqQuestion === undefined || body.faqQuestion === null
          ? question.questionText
          : requireNonEmptyString(body.faqQuestion, 'faqQuestion')
      if (faqQuestion.length < MIN_QUESTION_LENGTH || faqQuestion.length > MAX_FAQ_QUESTION_LENGTH) {
        throw new ValidationError(
          `faqQuestion must be between ${MIN_QUESTION_LENGTH} and ${MAX_FAQ_QUESTION_LENGTH} characters.`,
        )
      }
      const text = `Question: ${faqQuestion}\n\nAnswer from the instructor: ${content}`
      faq = {
        source: {
          id: crypto.randomUUID(),
          courseId: question.courseId,
          title: `FAQ: ${faqQuestion.length > 120 ? `${faqQuestion.slice(0, 117)}…` : faqQuestion}`,
          sourceType: 'faq',
          sourceUrl: null,
          storageKey: null,
          content: text,
          keywords: null,
          status: 'approved' as const,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        },
        chunks: chunkSegments([{ location: null, text }]),
      }
    }

    const reply = await createReply(
      db,
      { id: replyId, questionId: question.id, instructorId: user.id, content, createdAt: now },
      faq,
    )

    return sendData(c, 201, {
      reply,
      faqSource: faq ? { id: faq.source.id, title: faq.source.title, courseId: faq.source.courseId } : null,
    })
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})

/** The signed-in student's own questions, newest first, with reply and unread counts. */
replies.get('/me/questions', requireAuth, requireRole('student'), async (c) => {
  const items = await listStudentQuestions(getDb(c.env), c.get('user').id, QUESTION_LIST_LIMIT)
  return sendData(c, 200, {
    items,
    count: items.length,
    unreadReplies: items.reduce((sum, q) => sum + q.unreadReplies, 0),
  })
})

/** Questions in a course that need an instructor. ?filter=open (default) hides answered ones. */
replies.get('/instructor/inbox', requireAuth, requireRole('instructor'), async (c) => {
  const courseId = c.req.query('courseId')?.trim()
  if (!courseId) return sendError(c, 400, 'VALIDATION_ERROR', 'courseId query parameter is required.')
  const filter = c.req.query('filter') ?? 'open'
  if (filter !== 'open' && filter !== 'all') {
    return sendError(c, 400, 'VALIDATION_ERROR', 'filter must be open or all.')
  }

  const items = await listInbox(getDb(c.env), courseId, filter === 'open', QUESTION_LIST_LIMIT)
  return sendData(c, 200, { items, count: items.length, filter })
})
