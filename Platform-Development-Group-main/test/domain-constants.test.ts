import { describe, expect, it } from 'vitest'
import {
  ANSWER_MODES,
  isAnswerMode,
  isKnowledgeSourceStatus,
  isQuestionStatus,
  isReceivedEventStatus,
  isValidAnswerFeedbackRating,
  KNOWLEDGE_SOURCE_STATUSES,
  QUESTION_STATUSES,
  RECEIVED_EVENT_STATUSES,
} from '../src/lib/constants'

describe('knowledge source status', () => {
  it('accepts every defined status', () => {
    for (const status of KNOWLEDGE_SOURCE_STATUSES) {
      expect(isKnowledgeSourceStatus(status)).toBe(true)
    }
  })

  it('rejects values outside the defined set', () => {
    expect(isKnowledgeSourceStatus('deleted')).toBe(false)
    expect(isKnowledgeSourceStatus('')).toBe(false)
    expect(isKnowledgeSourceStatus(123)).toBe(false)
  })
})

describe('question status', () => {
  it('accepts every defined status', () => {
    for (const status of QUESTION_STATUSES) {
      expect(isQuestionStatus(status)).toBe(true)
    }
  })

  it('rejects an unknown status', () => {
    expect(isQuestionStatus('cancelled')).toBe(false)
  })
})

describe('answer mode', () => {
  it('accepts every defined mode', () => {
    for (const mode of ANSWER_MODES) {
      expect(isAnswerMode(mode)).toBe(true)
    }
  })

  it('rejects an unknown mode', () => {
    expect(isAnswerMode('manual')).toBe(false)
  })
})

describe('received event processing status', () => {
  it('accepts every defined status', () => {
    for (const status of RECEIVED_EVENT_STATUSES) {
      expect(isReceivedEventStatus(status)).toBe(true)
    }
  })

  it('rejects an unknown status', () => {
    expect(isReceivedEventStatus('duplicate')).toBe(false)
  })
})

describe('answer feedback rating', () => {
  it('accepts integers from 1 through 5', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(isValidAnswerFeedbackRating(rating)).toBe(true)
    }
  })

  it('rejects out-of-range, non-integer, and non-numeric values', () => {
    expect(isValidAnswerFeedbackRating(0)).toBe(false)
    expect(isValidAnswerFeedbackRating(6)).toBe(false)
    expect(isValidAnswerFeedbackRating(3.5)).toBe(false)
    expect(isValidAnswerFeedbackRating('3')).toBe(false)
  })
})
