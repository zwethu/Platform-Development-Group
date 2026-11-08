-- Week 12 — per-course daily AI invocation counter (PRD NFR-06, F-02).
-- One row per (UTC day, course). Incremented atomically with a conditional
-- upsert, so two simultaneous questions can never both take the last slot.
-- Additive only: the previous Worker version keeps working (PRD 14.4).

CREATE TABLE ai_usage (
  day TEXT NOT NULL,
  course_id TEXT NOT NULL,
  invocations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, course_id)
);
