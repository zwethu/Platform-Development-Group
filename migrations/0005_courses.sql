-- Courses owned by this service: an instructor creates a course (its code,
-- e.g. 1305308, and a name) and then adds its materials. Sources and
-- questions must belong to an existing course, which replaces free-text
-- course IDs (a typo used to silently create an empty "course").
--
-- Additive (PRD 14.4): knowledge_sources.course_id and questions.course_id
-- are unchanged, and every course ID already in use is turned into a course
-- below, so existing materials and questions keep working.

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_courses_status ON courses (status, id);

-- The CAREER course receives Team 17's internship opportunities by webhook.
INSERT INTO courses (id, name, description, status, created_by, created_at, updated_at)
VALUES ('CAREER', 'Careers & internships', 'Internship opportunities published by Team 17 (Internship).',
        'active', 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Every other course ID already used by a source or a question. Instructors
-- can rename these on the Courses page; our own course gets its real name.
INSERT OR IGNORE INTO courses (id, name, description, status, created_by, created_at, updated_at)
SELECT course_id,
       CASE course_id WHEN '1305308' THEN 'Platform Development' ELSE course_id END,
       NULL, 'active', 'migration', MIN(created_at), MAX(created_at)
FROM (
  SELECT course_id, created_at FROM knowledge_sources
  UNION ALL
  SELECT course_id, created_at FROM questions
)
GROUP BY course_id;
