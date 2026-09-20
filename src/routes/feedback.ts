import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { requireAuth } from '../middleware/auth'
import { sendData, sendError } from '../lib/http'
import { ValidationError, optionalNullableString, readJsonBody, requireNonEmptyString } from '../lib/validation'
import { isValidAnswerFeedbackRating } from '../lib/constants'
import { getDb } from '../lib/db'
import { createFeedback, findAnswerExists } from '../repositories/feedback-repository'

export const feedback = new Hono<AppEnv>()

feedback.use('*', requireAuth)

feedback.post('/answers/feedback', async (c) => {
  try {
    const body = await readJsonBody(c)

    const answerId = requireNonEmptyString(body.answerId, 'answerId')

    if (!isValidAnswerFeedbackRating(body.rating)) {
      throw new ValidationError('rating must be an integer from 1 to 5.')
    }
    const rating = body.rating

    const comment = optionalNullableString(body.comment, 'comment')

    const db = getDb(c.env)
    const answerExists = await findAnswerExists(db, answerId)
    if (!answerExists) return sendError(c, 404, 'NOT_FOUND', 'Answer not found.')

    const user = c.get('user')
    const created = await createFeedback(db, {
      id: crypto.randomUUID(),
      answerId,
      userId: user.id,
      rating,
      comment,
      createdAt: new Date().toISOString(),
    })

    return sendData(c, 201, created)
  } catch (err) {
    if (err instanceof ValidationError) return sendError(c, 400, 'VALIDATION_ERROR', err.message)
    throw err
  }
})
