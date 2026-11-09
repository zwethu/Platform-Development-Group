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
  /** Original file name when the text was extracted from an uploaded PDF/PPTX/DOCX; null for typed text. */
  fileName: string | null
  /** Pages, slides or sections extracted from the uploaded file; null for typed text. */
  segmentCount: number | null
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
  /** Set when the student asked for an instructor's reply ("Ask my instructor"). */
  escalatedAt: string | null
  escalationNote: string | null
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

/** A passage of a knowledge source (see src/services/chunking.ts). */
export interface SourceChunk {
  sourceId: string
  position: number
  location: string | null
  content: string
}

export interface InstructorReply {
  id: string
  questionId: string
  instructorId: string
  content: string
  faqSourceId: string | null
  createdAt: string
  readAt: string | null
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

// --- Temporary request-header identity (see src/middleware/auth.ts) ---

export type UserRole = 'student' | 'instructor'

export interface AuthUser {
  id: string
  role: UserRole
}
