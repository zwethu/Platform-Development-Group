# Learning Assistant API

Minimal Cloudflare Worker (Hono + TypeScript) scaffold for Assignment 3.
Implements only a versioned health check; all other routes will be added
incrementally per `PRD.md`.

## Prerequisites

- Node.js 18+ (developed against Node 24)
- npm
- A Cloudflare account — **not required yet**; only needed for a future
  assignment when we deploy or provision D1/R2

## Install

```
npm install
```

## Run locally

```
npm run dev
```

This starts `wrangler dev`, which runs the Worker entirely locally — no
Cloudflare account, login, or network dependency is required. By default
it listens on `http://127.0.0.1:8787`.

## Test the health endpoint

With the dev server running:

```
curl http://127.0.0.1:8787/v1/health
```

Expected response (`200`):

```json
{ "status": "ok", "service": "learning-assistant" }
```

Or run the automated test suite, which exercises the same route directly
through Hono without needing the dev server or any Cloudflare resource:

```
npm test
```

## Cloudflare D1

A D1 database is configured in `wrangler.jsonc` (binding `learning_assistant_db`,
database name `learning-assistant-db`). The binding's TypeScript types are
generated into `worker-configuration.d.ts` by `npx wrangler types` — regenerate
that file if the binding ever changes.

Apply the schema migrations to your **local** D1 (no Cloudflare login or
network access required):

```
npx wrangler d1 migrations apply learning-assistant-db --local
```

Applying to the remote/production database (`--remote` instead of `--local`)
requires `npx wrangler login` first and is a deliberate, separate step —
not part of routine local development.

See `PRD.md` §8 and §14 for the target schema and migration policy, and the
Data Model section below for what each table currently holds.

## Data Model

This service owns its own D1 database exclusively — no other Digital
Campus team's service reads or writes these tables directly, and this
service does not reach into any other team's data store either
(`PRD_DigitalCampus.md` §3).

| Table | Role |
|---|---|
| `knowledge_sources` | Instructor/TA-approved learning material for a course (`draft` \| `approved` \| `archived`). Only `approved`, non-archived sources are eligible for retrieval. |
| `questions` | A student's course-scoped question and its lifecycle status (`pending` \| `answered` \| `no_source_found` \| `failed`). |
| `answers` | The stored response to a question — `mode` is `ai` or `fallback`, and `no_source_found` flags an honest "nothing approved covers this" result. One answer per question (`question_id` is `UNIQUE`). |
| `citations` | Evidence linking an answer back to the `knowledge_sources` excerpt(s) it was grounded in. |
| `answer_feedback` | A user's helpful/not-helpful style rating (1–5) and optional comment on an answer. |
| `received_events` | Idempotency ledger for signed inbound webhooks (e.g. `assignment.published`). A consumer checks whether `event_id` already exists before doing any work; since it's the table's primary key, a duplicate delivery cannot be processed twice. |

Migration SQL lives in `migrations/`; the current schema is
`migrations/0001_initial_learning_assistant_schema.sql`. Shared TypeScript
types mirroring these tables (camelCase, matching the SQL's snake_case
columns) live in `src/lib/types.ts`, with the finite status/mode value sets
and validation helpers in `src/lib/constants.ts`.

## Project layout

- `src/index.ts` — Hono app entry, mounts `/v1` routes
- `src/routes/` — route modules
- `src/lib/http-error.ts` — shared JSON error helper for future routes
- `src/lib/types.ts` — shared domain types (`KnowledgeSource`, `Question`, `Answer`, `Citation`, `AnswerFeedback`, `ReceivedEvent`, etc.)
- `src/lib/constants.ts` — finite status/mode value sets and validation helpers
- `src/lib/db.ts` — accessor for this service's D1 binding
- `migrations/` — D1 migration SQL
- `test/` — Vitest tests
