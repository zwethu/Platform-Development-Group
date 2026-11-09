-- Learning Assistant — initial schema.
-- Owned exclusively by this service; no other team's service may read or
-- write these tables directly (PRD_DigitalCampus.md §3: service-owned data).

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  storage_key TEXT,
  content TEXT,
  keywords TEXT,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'approved', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'no_source_found', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  mode TEXT NOT NULL
    CHECK (mode IN ('ai', 'fallback')),
  no_source_found INTEGER NOT NULL DEFAULT 0
    CHECK (no_source_found IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE
);

CREATE TABLE citations (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  location TEXT,
  score REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (answer_id) REFERENCES answers (id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources (id) ON DELETE RESTRICT
);

CREATE TABLE answer_feedback (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL
    CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (answer_id) REFERENCES answers (id) ON DELETE CASCADE
);

-- Idempotency ledger for signed inbound webhooks (e.g. assignment.published).
-- event_id is the idempotency key: a consumer looks it up before processing
-- and skips work if a row already exists.
CREATE TABLE received_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'failed'))
);

CREATE INDEX idx_knowledge_sources_course_status ON knowledge_sources (course_id, status);
CREATE INDEX idx_knowledge_sources_course_title ON knowledge_sources (course_id, title);
CREATE INDEX idx_questions_student_created ON questions (student_id, created_at);
CREATE INDEX idx_questions_course_created ON questions (course_id, created_at);
CREATE INDEX idx_citations_answer_id ON citations (answer_id);
CREATE INDEX idx_citations_source_id ON citations (source_id);
CREATE INDEX idx_answer_feedback_answer_id ON answer_feedback (answer_id);
CREATE INDEX idx_received_events_type_received ON received_events (event_type, received_at);
