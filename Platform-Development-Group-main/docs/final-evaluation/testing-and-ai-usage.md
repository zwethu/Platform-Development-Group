# Testing, Development Process and AI Usage — Team 08

Final evaluation evidence for **requirement 6 (testing and QA)** and **requirement 4
(development workflow, team contributions, AI tools, git history)**.

---

## Part A — Testing

### A1. Automated tests

Framework: **vitest**. Command: `npm test`. Routes are called through Hono directly
(`app.request(...)`) against an in-memory SQLite D1 stand-in, so no Cloudflare account is needed.

**Result (2026-11-10, commit `ed9f5ec`): 17 files, 167 tests, all passing.**

| Test file | Tests | What it proves |
|---|---:|---|
| `source-uploads.test.ts` | 23 | PDF/PPTX/DOCX text upload, chunking, slide-level citations, size and type limits, instructor-only |
| `courses.test.ts` | 18 | Course create/archive, code validation, sources and questions need an active course, end-to-end flow |
| `routes-auth-and-validation.test.ts` | 16 | Role restrictions, input validation (400 before touching the DB), correlation IDs |
| `ai-answer-service.test.ts` | 15 | Invented or missing citations rejected, prompt injection kept as data, timeout fallback |
| `instructor-replies.test.ts` | 13 | Escalation, inbox, replies private to the asking student, reply saved as course material |
| `validation.test.ts` | 13 | Validation helpers |
| `identity-auth.test.ts` | 11 | Team 01 sign-in: forged/expired tokens rejected, 503 when Team 01 is down |
| `domain-constants.test.ts` | 10 | Status, rating and length rules |
| `team17-integration.test.ts` | 9 | Outbound webhook (earlier assignment) |
| `health-ready.test.ts` | 8 | Deep health: database, AI, budget; missing migrations reported as `down` |
| `fallback-search-service.test.ts` | 7 | Keyword search ranking and course isolation |
| `internship-webhook.test.ts` | 7 | Inbound webhook signature and idempotency (earlier assignment) |
| `feedback.test.ts` | 6 | Only the owner or an instructor can rate; one changeable rating per user |
| `webhook-signature.test.ts` | 5 | HMAC-SHA-256 verification |
| `question-authorization.test.ts` | 3 | A student cannot view another student's question |
| `integration-status.test.ts` | 2 | Integration status endpoint |
| `health.test.ts` | 1 | Liveness |

Most tests are **negative cases**: they send bad input or an unauthorised request and check
it is refused with the right status and that nothing is written.

### A2. Manual testing (human verification)

Done on 2026-11-10 by clicking through the web UI (M1–M12 in local mode with `npm run dev:local`,
AI off, demo sign-in) and on the deployed system (M13–M14, real Student Identity sign-in).

| # | Step | Expected | Result |
|---|---|---|---|
| M1 | Instructor creates course `1305308` | "Course 1305308 created", listed under All courses | ✅ Pass |
| M2 | Instructor adds a text source to the course | Listed under Approved sources (1) | ✅ Pass |
| M3 | Student asks "How should a webhook be signed?" | Answer with `[1]` citation and a Sources list | ✅ Pass (keyword fallback, because AI was off) |
| M4 | Student rates the answer 5 | Rating stored (checked in D1: `rating = 5`) | ✅ Pass |
| M5 | Student clicks "Ask my instructor" with a note | Question appears in the instructor inbox with the note | ✅ Pass |
| M6 | Instructor replies | Student's "My questions" shows "New instructor reply" | ✅ Pass |
| M7 | Student opens the Ask page for a course without a description | Approved materials panel shows only the sources | ✅ Pass after fix. The first run failed: the panel showed the word "null". Fixed in `ed9f5ec` and re-tested |
| M8 | Student calls `POST /v1/sources` | 403 | ✅ Pass |
| M9 | Student B opens student A's question | 403 "You do not have access to this question." | ✅ Pass |
| M10 | No credentials | 401 | ✅ Pass |
| M11 | Invalid question body | 400 `VALIDATION_ERROR` | ✅ Pass |
| M12 | Response headers on `/` | CSP and `X-Frame-Options: DENY` present | ✅ Pass |
| M13 | Sign in with a Team 01 account on the deployed site; ask a question and get an AI answer | Token from Team 01, AI answer with citations | ✅ Pass |
| M14 | API requests in Postman ([collection](../../postman/Learning-Assistant-API.postman_collection.json)) against the deployed URL | Documented status codes | ✅ Pass |

### A3. Failures found and fixed (evidence that testing works)

| Found by | Problem | Fix |
|---|---|---|
| Manual test M7 | "null" shown on the Ask page when a course had no description | `ed9f5ec`: `replaceChildren` turns `null` into text, so pass `''` |
| Code review | Deep health reported `ok` even when migrations 0004/0005 were missing | `b6e1641`: check the new tables, plus a test |
| Review of the feedback route | A student could rate another student's answer, and rate the same answer many times | `5d4d689`: ownership check, one rating per user, plus tests |
| Load test (Week 12) | p95 latency 4091 ms with the 8B model | Switched to `llama-3.2-3b`: p95 **756 ms** ([details](../week12-handover/README.md)) |

### A4. Performance

From the Week 12 load test (100 requests, budget p95 ≤ 5000 ms):
p50 541 ms, **p95 756 ms**, p99 829 ms, 8.72 req/s. Raw data is in
[docs/week12-handover/loadtest/](../week12-handover/loadtest/).

---

## Part B — Development process

### B1. Workflow

1. **Requirements first**: PRD with functional (FR) and non-functional (NFR) requirements
   ([md_files/PRD.md](../../md_files/PRD.md)). Code comments reference the requirement they
   implement (e.g. `PRD FR-03`).
2. **Contract and data design**: API contract and ER design before code
   ([assignment 3](../assignment-3-data-query-design.md)).
3. **Vertical slices**: each feature lands with its migration, route, repository and tests together.
4. **Git**: work on `main` or short feature branches merged into `main`
   (e.g. `feature/uploads-and-replies`). Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`).
5. **Before every commit**: `npm test` and `npm run typecheck` pass.
6. **Deploy**: one member holds Cloudflare access and runs `npm run deploy` plus the remote
   migrations. Other members commit and ask for a deploy.

### B2. Team contributions

Roles are as assigned in the PRD ([md_files/PRD.md](../../md_files/PRD.md), "Team members
and review roles"). All five members are developers, and each also owns one review role.

| # | Member | Role | Responsible for |
|---:|---|---|---|
| 1 | Khant Wai Lin | Product Manager | Scope and priorities, user journeys and acceptance criteria, coordination with partner teams |
| 2 | Thura Aung | Frontend UX/UI | Web UI screens, usability and accessibility, consistent visual design |
| 3 | Thaw Zin Myo Aung | Backend API and Database | API endpoints and contract, data model and migrations, data integrity |
| 4 | Sai Aung Kham | Quality and Security | Test strategy and test results, security controls, PDPA review |
| 5 | Zwe Thura Aung | Delivery and Document | Delivery plan and releases, project documentation and evidence |

---

## Part C — AI tools used

Each member used AI inside their own role, and checked its output with the method that role
owns.

| Role (member) | Tool | How AI was used in this role | How the output was evaluated |
|---|---|---|---|
| **Product Manager** (Khant Wai Lin) | Claude Code | Turning PRD requirements into features (Student Identity sign-in, courses, uploads, replies); drafting user journeys and acceptance criteria; planning the integration with Team 01 | Every feature checked against its PRD requirement (FR/NFR IDs cited in the code); demo Happy Path walked end to end; Team 01 sign-in confirmed with real accounts |
| **Frontend UX/UI** (Thura Aung) | GitHub Copilot | Suggesting CSS and layout for the UI style refresh; completing repetitive UI code | Checked in the browser at desktop and phone width, in light and dark themes; no `innerHTML` (XSS rule); CSP still passes with no inline scripts or styles |
| **Backend API and Database** (Thaw Zin Myo Aung) | Claude Code | Explaining the codebase; tracing the request flow; finding that deep health ignored migrations 0004/0005 and fixing it; tracing a UI "null" bug to one line; checking SQL and authorization while drafting these evidence docs | Reviewed each diff line by line; `npm test` (167 pass) and `npm run typecheck`; a new test that fails without the fix; re-tested in the browser; every claim in these docs checked against the code |
| **Quality and Security** (Sai Aung Kham) | GitHub Copilot | Suggesting negative test cases (forged tokens, other students' data, out-of-range input); reviewing controls against the OWASP Top 10; checking the PDPA data inventory | Each suggested case written as a real test or curl request and run; a control counts only when its 401/403/400 response is seen (see [security-and-pdpa.md](security-and-pdpa.md) §B2) |
| **Delivery and Document** (Zwe Thura Aung) | Claude Code | Week 12 work: AI answer path, structured logs, deep health, load-test script; drafting the runbook and handover docs | Load test run against the budget (p95 ≤ 5000 ms, result 756 ms); model choices compared on measured data, not AI opinion; docs checked against the running system |

**Common rule for all roles:** AI output is a draft. Nothing is merged unless the member has
read it and can explain it, `npm test` and `npm run typecheck` pass, and anything visible to
users was checked in the running app.

**AI inside the product** (not a development tool): Workers AI `llama-3.2-3b-instruct`
writes answers only from approved passages. Guardrails: a fixed system prompt, passages sent
as data, JSON-only output, citation validation, a 15 s timeout, a per-course daily budget,
and a keyword fallback. See [security-and-pdpa.md](security-and-pdpa.md) and
[architecture.md](architecture.md).
