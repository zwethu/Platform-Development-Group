// Finite value sets for the domain types in ./types.ts, plus validation
// helpers so callers can reject bad input before it reaches storage.

import type {
  AnswerMode,
  KnowledgeSourceStatus,
  QuestionStatus,
  ReceivedEventStatus,
} from './types'

export const KNOWLEDGE_SOURCE_STATUSES: readonly KnowledgeSourceStatus[] = [
  'draft',
  'approved',
  'archived',
]

export const QUESTION_STATUSES: readonly QuestionStatus[] = [
  'pending',
  'answered',
  'no_source_found',
  'failed',
]

export const ANSWER_MODES: readonly AnswerMode[] = ['ai', 'fallback']

export const RECEIVED_EVENT_STATUSES: readonly ReceivedEventStatus[] = [
  'received',
  'processed',
  'failed',
]

export const MIN_ANSWER_FEEDBACK_RATING = 1
export const MAX_ANSWER_FEEDBACK_RATING = 5

export function isKnowledgeSourceStatus(value: unknown): value is KnowledgeSourceStatus {
  return typeof value === 'string' && (KNOWLEDGE_SOURCE_STATUSES as readonly string[]).includes(value)
}

export function isQuestionStatus(value: unknown): value is QuestionStatus {
  return typeof value === 'string' && (QUESTION_STATUSES as readonly string[]).includes(value)
}

export function isAnswerMode(value: unknown): value is AnswerMode {
  return typeof value === 'string' && (ANSWER_MODES as readonly string[]).includes(value)
}

export function isReceivedEventStatus(value: unknown): value is ReceivedEventStatus {
  return typeof value === 'string' && (RECEIVED_EVENT_STATUSES as readonly string[]).includes(value)
}

export function isValidAnswerFeedbackRating(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_ANSWER_FEEDBACK_RATING &&
    value <= MAX_ANSWER_FEEDBACK_RATING
  )
}
