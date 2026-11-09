-- Uploaded course files (PDF / PPTX / DOCX) and instructor replies.
--
-- Additive only (PRD 14.4): new tables and nullable columns, so a Worker
-- version deployed before this migration keeps working against the new schema.

-- A knowledge source's text, split into passages of about 1,000 characters.
-- Search ranks chunks instead of whole sources, so a 40-slide deck is cited
-- by the slide that actually answers the question ("Slide 14"), and the AI
-- reads that passage instead of only the first part of the document.
-- Sources with no chunks (created before this migration, or by the Team 17
-- webhook) are still searched by their `content` column, as before.
CREATE TABLE source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  location TEXT,
  content TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_sources (id) ON DELETE CASCADE
);

CREATE INDEX idx_source_chunks_source_position ON source_chunks (source_id, position);

-- Set when the source was uploaded from a file. The file itself is never
-- stored: the instructor's browser extracts the text and sends only that.
ALTER TABLE knowledge_sources ADD COLUMN file_name TEXT;
ALTER TABLE knowledge_sources ADD COLUMN segment_count INTEGER;

-- A student pressed "Ask my instructor" on their question.
ALTER TABLE questions ADD COLUMN escalated_at TEXT;
ALTER TABLE questions ADD COLUMN escalation_note TEXT;

CREATE TABLE instructor_replies (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  instructor_id TEXT NOT NULL,
  content TEXT NOT NULL,
  -- The FAQ knowledge source created from this reply, when the instructor
  -- chose "Also add to course materials".
  faq_source_id TEXT,
  created_at TEXT NOT NULL,
  -- When the student who asked first opened the reply (unread badge).
  read_at TEXT,
  FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE,
  FOREIGN KEY (faq_source_id) REFERENCES knowledge_sources (id) ON DELETE SET NULL
);

CREATE INDEX idx_instructor_replies_question_created ON instructor_replies (question_id, created_at);
CREATE INDEX idx_questions_course_escalated ON questions (course_id, escalated_at);
