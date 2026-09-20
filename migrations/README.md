# Migrations

Cloudflare D1 migration SQL files, applied in numeric order with
`npx wrangler d1 migrations apply learning-assistant-db --local` (see the
README's "Cloudflare D1" section for details).

- `0001_initial_learning_assistant_schema.sql` — `knowledge_sources`,
  `questions`, `answers`, `citations`, `answer_feedback`, and
  `received_events` (the inbound-webhook idempotency ledger), plus their
  indexes.
