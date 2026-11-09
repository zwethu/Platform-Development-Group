import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { requireAuth } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalNullableString, readJsonBody, requireNonEmptyString } from '../lib/validation'
import { MAX_FEEDBACK_COMMENT_LENGTH, isValidAnswerFeedbackRating } from '../lib/constants'
import { getDb } from '../lib/db'
import { findAnswerOwner, upsertFeedback } from '../repositories/feedback-repository'
import { canViewQuestion } from './questions'

export const feedback = new Hono<AppEnv>()

// requireAuth is applied per-route (not via `.use('*', ...)`) — see the
// comment in src/routes/sources.ts for why a wildcard here would leak
// onto unrelated public routes mounted alongside this sub-app.

feedback.post('/answers/feedback', requireAuth, async (c) => {
  try {
    const body = await readJsonBody(c)

    const answerId = requireNonEmptyString(body.answerId, 'answerId')

    if (!isValidAnswerFeedbackRating(body.rating)) {
      throw new ValidationError('rating must be an integer from 1 to 5.')
    }
    const rating = body.rating

    const comment = optionalNullableString(body.comment, 'comment')
    if (comment !== null && comment.length > MAX_FEEDBACK_COMMENT_LENGTH) {
      throw new ValidationError(`comment must be at most ${MAX_FEEDBACK_COMMENT_LENGTH} characters.`)
    }

    const db = getDb(c.env)
    const owner = await findAnswerOwner(db, answerId)
    if (!owner) return sendError(c, 404, 'NOT_FOUND', 'Answer not found.')

    // Same rule as reading the question: a student may only rate an answer
    // to their own question; instructors may rate any answer.
    const user = c.get('user')
    if (!canViewQuestion(user, owner)) {
      return sendError(c, 403, 'FORBIDDEN', 'You do not have access to this answer.')
    }

    const { feedback: saved, created } = await upsertFeedback(db, {
      id: crypto.randomUUID(),
      answerId,
      userId: user.id,
      rating,
      comment,
      createdAt: new Date().toISOString(),
    })

    return sendData(c, created ? 201 : 200, saved)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})
