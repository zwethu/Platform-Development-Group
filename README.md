# Learning Assistant API

Cloudflare Worker (Hono + TypeScript + D1) for Team 08's Learning Assistant.
Implements the versioned health check plus the seven `/v1` REST endpoints
for knowledge sources, questions (with a deterministic fallback answer),
and answer feedback. See `PRD.md` for the full product spec.

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

> **Note:** the D1 binding in `wrangler.jsonc` is marked `"remote": true`,
> which makes plain `wrangler dev`/`npm run dev` talk to the **real**
> Cloudflare D1 database for that binding (mixed-mode dev) instead of the
> local simulated one. For fully offline local development against the
> local D1 file described below, run `npx wrangler dev --local` instead,
> which disables remote bindings. This is worth the team confirming
> deliberately (see the task report's design-decisions list) rather than
> leaving as an accidental default.

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

## API

All business routes are under `/v1` and require two temporary identity
headers (see "Temporary identity headers" below). Responses are JSON:
success as `{ "data": ... }`, errors as
`{ "error": { "code", "message", "correlationId" } }`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/v1/health` | none | Liveness check (unauthenticated) |
| POST | `/v1/sources` | instructor | Register a knowledge source |
| PATCH | `/v1/sources/:id` | instructor | Update a source's fields |
| DELETE | `/v1/sources/:id` | instructor | **Archive** a source (soft delete — see below) |
| GET | `/v1/courses/:courseId/sources` | student, instructor | List that course's `approved` sources |
| POST | `/v1/questions` | student | Ask a question; gets a fallback answer + citations |
| GET | `/v1/questions/:id` | owning student, instructor | Read a question with its answer and citations |
| POST | `/v1/answers/feedback` | student, instructor | Rate an answer (1–5) |

### Temporary identity headers

**This is a temporary stand-in for real Student Identity integration —
not real authentication.** There is no signature or token check; any
caller can claim any identity. It exists only to unblock this vertical
slice and must be replaced with real Identity/JWT verification (PRD.md
FR-01 / NFR-03) before this goes anywhere beyond the course project.

Every `/v1` route except `/v1/health` requires:

- `x-user-id`: any non-empty string — used as the caller's user id (never
  taken from the request body)
- `x-user-role`: `student` or `instructor`

Missing or invalid headers return `401 UNAUTHORIZED`; a role not allowed
on that route returns `403 FORBIDDEN`. Every response also carries an
`x-correlation-id` header (echoing the request's own header if it sent
one, otherwise a generated id), which also appears inside error bodies.

### `DELETE /v1/sources/:id` is archive, not delete

This never physically removes a row. It sets `status = 'archived'` and
`updated_at` to now, which immediately excludes the source from
`GET /v1/courses/:courseId/sources` (which only returns `approved`
sources) while preserving history. It's idempotent — archiving an
already-archived source still returns `200` with that source.

### Fallback question-answering

`POST /v1/questions` never calls an LLM. It's a deterministic keyword
search:

1. Only `approved` (non-draft, non-archived) knowledge sources for the
   question's course are searched.
2. The question is tokenized and matched (case-insensitively) against
   each source's title, keywords, and content — a title match ranks
   above a keyword match, which ranks above a content-only match.
3. If any sources match, an answer is built from their title(s) and a
   short excerpt of each, with one citation per matched source
   (`mode: "fallback"`, `noSourceFound: false`), and the question's
   status becomes `answered`.
4. If nothing matches, the answer is the fixed message *"I could not
   find an answer in the approved materials for this course. Please
   check with your instructor."* with no citations
   (`noSourceFound: true`), and the question's status becomes
   `no_source_found`.

The answer never states anything beyond what a matched source's
title/excerpt actually contains — it is a citation list with a short
templated wrapper, not a generated explanation.

### curl examples

Create a knowledge source (instructor):

```
curl -X POST http://127.0.0.1:8787/v1/sources \
  -H 'x-user-id: instr-1' -H 'x-user-role: instructor' \
  -H 'Content-Type: application/json' \
  -d '{
        "courseId": "SE101",
        "title": "Week 3 REST API Slides",
        "sourceType": "document",
        "content": "REST APIs use HTTP verbs like GET and POST to manipulate resources.",
        "keywords": ["rest", "api", "http"]
      }'
```

Ask a question (student):

```
curl -X POST http://127.0.0.1:8787/v1/questions \
  -H 'x-user-id: student-a' -H 'x-user-role: student' \
  -H 'Content-Type: application/json' \
  -d '{ "courseId": "SE101", "questionText": "What is a REST API?" }'
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

- `src/index.ts` — Hono app entry, wires correlation-id middleware and mounts `/v1` routes
- `src/routes/` — route modules (`health.ts`, `sources.ts`, `questions.ts`, `feedback.ts`)
- `src/middleware/auth.ts` — **temporary** header-based identity + role checks (see API docs above)
- `src/middleware/correlation-id.ts` — `x-correlation-id` generation/echo
- `src/services/fallback-search-service.ts` — deterministic keyword matching, no LLM
- `src/repositories/` — D1 access per resource (`sources-repository.ts`, `questions-repository.ts` [also answers/citations], `feedback-repository.ts`)
- `src/lib/http.ts` — `{ data }` / `{ error }` response envelope for the v1 business routes
- `src/lib/http-error.ts` — older JSON error helper still used by the pre-existing 404 handler
- `src/lib/validation.ts` — dependency-free request-body validation helpers
- `src/lib/app-env.ts` — shared Hono `Bindings`/`Variables` generic type
- `src/lib/types.ts` — shared domain types (`KnowledgeSource`, `Question`, `Answer`, `Citation`, `AnswerFeedback`, `ReceivedEvent`, `AuthUser`, etc.)
- `src/lib/constants.ts` — finite status/mode value sets and validation helpers
- `src/lib/db.ts` — accessor for this service's D1 binding
- `migrations/` — D1 migration SQL
- `test/` — Vitest tests
