// Shared domain types for the Learning Assistant service.
// Mirrors migrations/0001_initial_learning_assistant_schema.sql — snake_case
// in SQL, camelCase here. Keep the two in sync when the schema changes.

export type KnowledgeSourceStatus = 'draft' | 'approved' | 'archived'

export interface KnowledgeSource {
  id: string
  courseId: string
  title: string
  sourceType: string
  sourceUrl: string | null
  storageKey: string | null
  content: string | null
  keywords: string | null
  status: KnowledgeSourceStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type QuestionStatus = 'pending' | 'answered' | 'no_source_found' | 'failed'

export interface Question {
  id: string
  courseId: string
  studentId: string
  questionText: string
  status: QuestionStatus
  createdAt: string
  updatedAt: string
}

export type AnswerMode = 'ai' | 'fallback'

export interface Answer {
  id: string
  questionId: string
  content: string
  mode: AnswerMode
  noSourceFound: boolean
  createdAt: string
}

export interface Citation {
  id: string
  answerId: string
  sourceId: string
  excerpt: string
  location: string | null
  score: number | null
  createdAt: string
}

export interface AnswerFeedback {
  id: string
  answerId: string
  userId: string
  rating: number
  comment: string | null
  createdAt: string
}

export type ReceivedEventStatus = 'received' | 'processed' | 'failed'

export interface ReceivedEvent {
  eventId: string
  eventType: string
  source: string
  occurredAt: string
  receivedAt: string
  payloadJson: string
  processingStatus: ReceivedEventStatus
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
  }
}
