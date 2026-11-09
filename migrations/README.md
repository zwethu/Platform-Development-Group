# Migrations

Cloudflare D1 migration SQL files, applied in numeric order with
`npx wrangler d1 migrations apply learning-assistant-db --local` (see the
README's "Cloudflare D1" section for details).

- `0001_initial_learning_assistant_schema.sql` — `knowledge_sources`,
  `questions`, `answers`, `citations`, `answer_feedback`, and
  `received_events` (the inbound-webhook idempotency ledger), plus their
  indexes.
- `0002_outbound_webhook_deliveries.sql` — `outbound_webhook_deliveries`
  (Assignment 5: logs every outbound call this service makes to a partner
  webhook — currently Team 17's `/api/webhooks/partner` — success or
  failure), plus its indexes.
- `0003_ai_usage_budget.sql` — `ai_usage` (per-course daily AI call counter).
- `0004_source_chunks_and_instructor_replies.sql` — `source_chunks` (passages
  that search ranks, with page/slide labels), `instructor_replies`, and new
  nullable columns `knowledge_sources.file_name` / `segment_count` and
  `questions.escalated_at` / `escalation_note`. Additive only.
- `0005_courses.sql` — `courses` (created by instructors). Turns every course
  ID already used by a source or question into a course, and adds `CAREER`.
