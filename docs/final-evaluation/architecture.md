# Architecture — Learning Assistant (Team 08)

Final evaluation evidence for **requirement 4: system architecture and design**.

## 1. What the system does

Students ask course questions and get answers built **only** from instructor-approved
course materials, and every answer cites its sources. Instructors manage courses and
materials and reply to students who still need help.

## 2. Components

```mermaid
flowchart LR
  subgraph Browser
    UI["Web UI<br/>public/ (HTML + JS, no framework)"]
  end
  subgraph Cloudflare["Cloudflare (one Worker)"]
    ASSETS["Static assets<br/>public/"]
    API["Hono API /v1<br/>src/"]
    D1[("D1 (SQLite)<br/>learning-assistant-db")]
    AI["Workers AI<br/>llama-3.2-3b-instruct"]
  end
  T01["Student Identity<br/>(Team 01)"]

  UI -- "1. sign in: POST /auth/login" --> T01
  UI -- "2. API calls + Bearer token" --> API
  API -- "3. verify token: GET /me" --> T01
  API -- "SQL (bound parameters)" --> D1
  API -- "question + approved passages" --> AI
  ASSETS -. serves .-> UI
```

| Component | Technology | Why |
|---|---|---|
| Web UI | Plain HTML/CSS/JS in `public/` | Served by the same Worker, so UI and API deploy together. No build step. |
| API | Cloudflare Worker + Hono (TypeScript) | Runs at the edge. Hono is the only runtime dependency. |
| Database | Cloudflare D1 (SQLite) | Relational data with foreign keys and CHECK constraints. Schema lives in numbered migrations. |
| AI | Workers AI (`@cf/meta/llama-3.2-3b-instruct`) | Free daily allocation with no payment method. Cut off after 15 s, with a per-course daily budget. |
| Sign-in | Student Identity (Team 01) | Cross-group integration; see [team01-integration.md](team01-integration.md). |

## 3. Code layout (layered)

```
src/index.ts            wires middleware + routes under /v1
src/middleware/         correlation id → request logger → auth (per route)
src/routes/             HTTP: parse + validate input, check role, shape response
src/services/           logic: AI answer, keyword fallback search, chunking, identity client
src/repositories/       all SQL, always with bound parameters
src/lib/                validation, error shape, structured logger, constants
migrations/             0001 → 0005, applied in order
public/                 web UI (app.js, file-extract.js for PDF/PPTX/DOCX text)
test/                   vitest suites (167 tests)
```

## 4. Request flow: a student asks a question

```mermaid
sequenceDiagram
  participant S as Student (browser)
  participant W as Worker /v1/questions
  participant T as Student Identity (Team 01)
  participant DB as D1
  participant AI as Workers AI

  S->>W: POST /v1/questions {courseId, questionText} + Bearer token
  W->>T: GET /me (token)  [cached 60 s]
  T-->>W: 200 (genuine token)
  W->>W: role = student? length 3–1000?
  W->>DB: keyword search over approved chunks of this course
  alt matches found and AI within budget
    W->>AI: system prompt + numbered passages (as data) + question
    AI-->>W: {"answer", "citations":[n]}
    W->>W: validate JSON, citations must be passages we sent
  else no AI / AI fails / invalid output
    W->>W: keyword fallback answer (labelled as not AI)
  end
  W->>DB: insert question, answer, citations
  W-->>S: 201 answer + sources + mode (ai | fallback)
```

The answer is never lost: if the AI is turned off, slow (over 15 s), over its daily budget,
or returns output that fails validation, the student still gets a labelled keyword-search answer.

## 5. Data model (after migration 0005)

```mermaid
erDiagram
  courses ||--o{ knowledge_sources : "has"
  courses ||--o{ questions : "has"
  knowledge_sources ||--o{ source_chunks : "split into"
  knowledge_sources ||--o{ citations : "cited by"
  questions ||--|| answers : "has one"
  answers ||--o{ citations : "cites"
  answers ||--o{ answer_feedback : "rated by"
  questions ||--o{ instructor_replies : "replied to"

  courses { text id PK  text name  text description  text status  text created_by }
  knowledge_sources { text id PK  text course_id  text title  text source_type  text content  text status  text file_name  int segment_count }
  source_chunks { text id PK  text source_id FK  int position  text location  text content }
  questions { text id PK  text course_id  text student_id  text question_text  text status  text escalated_at  text escalation_note }
  answers { text id PK  text question_id FK  text content  text mode  int no_source_found }
  citations { text id PK  text answer_id FK  text source_id FK  text excerpt  real score }
  answer_feedback { text id PK  text answer_id FK  text user_id  int rating  text comment }
  instructor_replies { text id PK  text question_id FK  text instructor_id  text content  text read_at }
```

Supporting tables: `ai_usage` (daily AI budget), `received_events` and
`outbound_webhook_deliveries` (webhook idempotency and delivery log).

| Migration | Adds |
|---|---|
| 0001 | Core tables: sources, questions, answers, citations, feedback, received events |
| 0002 | Outbound webhook deliveries |
| 0003 | AI usage budget |
| 0004 | `source_chunks` (uploaded files split into passages), `instructor_replies`, question escalation |
| 0005 | `courses`. Every source and question now belongs to a course |

`GET /v1/health/ready` checks that every table above exists, so a deployment that
skipped a migration reports `down` instead of `ok`.

## 6. API surface (`/v1`)

| Area | Endpoints | Who |
|---|---|---|
| Health | `GET /health`, `GET /health/ready` | public |
| Auth | `GET /auth/config`, `GET /me` | public / signed in |
| Courses | `GET /courses`, `GET /courses/:id`, `POST /courses`, `PATCH /courses/:id` | read: all · write: instructor |
| Sources | `GET /courses/:id/sources`, `POST /sources`, `PATCH /sources/:id`, `DELETE /sources/:id` (archive) | read: all · write: instructor |
| Questions | `POST /questions`, `GET /questions/:id`, `GET /me/questions` | student asks; only the owner or an instructor can read |
| Help | `POST /questions/:id/escalate`, `POST /questions/:id/replies`, `GET /instructor/inbox` | student / instructor |
| Feedback | `POST /answers/feedback` | rating 1–5, one per user |

The full request collection is in [`postman/`](../../postman/Learning-Assistant-API.postman_collection.json).

## 7. Deployment

- `npm run deploy:khant` publishes UI and API together as one Worker to
  `https://learning-assistant-api.6731503060.workers.dev` (the `khant` environment and its D1 database).
- Remote migrations: `npm run db:migrate:khant` (applies only the missing ones).
- Team members with access to the Cloudflare account can deploy; everyone commits to `main` first.
- Environments in `wrangler.jsonc`: the default (deployed, `AUTH_MODE=identity`), `local`
  (local D1 file, demo sign-in for offline development), and `khant` (a team member's deployment).
