# Security and PDPA — Learning Assistant (Team 08)

Final evaluation evidence for **requirement 5: security mechanisms, PDPA compliance,
attack prevention, and evidence that the controls work**.

PDPA here means Thailand's **Personal Data Protection Act B.E. 2562 (2019)**.

---

## Part A — Personal data (PDPA)

### A1. What personal data we hold

| Data | Where | Why we need it | Who can see it |
|---|---|---|---|
| User ID (`sub` from Student Identity, e.g. a student number) | `questions.student_id`, `answer_feedback.user_id`, `instructor_replies.instructor_id`, `created_by` columns | Show students their own questions; prevent double ratings; record who changed course materials | The student themself; instructors |
| Question text | `questions.question_text` | Answer the question and keep it in "My questions" | The asking student; instructors |
| "Ask my instructor" note | `questions.escalation_note` | Tell the instructor what is still unclear | The asking student; instructors |
| Feedback rating and comment | `answer_feedback` | Measure answer quality; flag weak answers (rating ≤ 2) for instructors | Instructors |
| Instructor reply | `instructor_replies.content` | Answer the student | The asking student; instructors |
| Role (student / instructor) | Not stored. Worked out from the token on every request | Authorization | — |

### A2. What we deliberately do NOT collect or keep

| Not kept | How |
|---|---|
| **Passwords** | Sign-in goes straight from the browser to Team 01. Our server never receives the password, and the UI clears the password field after each attempt ([public/app.js](../../public/app.js)). |
| **Name, email and other profile data** | Team 01's `GET /me` response body is read and thrown away. We use only `sub` and `role` from the token ([src/services/identity-client.ts](../../src/services/identity-client.ts)). |
| **Uploaded files** | PDF, PPTX and DOCX text is extracted **in the browser** ([public/file-extract.js](../../public/file-extract.js)). The file itself is never uploaded or stored; only the extracted course text is saved. |
| **Tokens in logs** | Tokens are never logged. The verification cache is keyed by a SHA-256 hash, not the token. |
| **Question, answer and source text in logs** | Logger rule: only IDs, lengths, counts and outcomes are logged ([src/lib/logger.ts](../../src/lib/logger.ts)). Request logs record the route pattern (`/v1/questions/:id`), not IDs from the path, for statistics. |

### A3. PDPA principles and how we meet them

| PDPA principle | How the system meets it |
|---|---|
| **Purpose limitation** (s.21) | Data is used only to answer course questions and support students. No analytics, advertising or sharing. |
| **Data minimisation** (s.22) | Only `sub` and `role` are taken from the identity provider (see A2). The role is not stored. |
| **Lawful basis** (s.24) | Processing is needed to provide the learning service the student signs in to use. |
| **Access limited to those who need it** | Students see only their own questions (`403` otherwise). Only instructors see the inbox and other students' questions. See B2. |
| **Security of processing** (s.37(1)) | HTTPS only (Cloudflare), token verification, role checks, input validation, CSP. See Part B. |
| **No transfer to third parties** | Questions are answered by **Workers AI inside Cloudflare**, the same provider that hosts the database. Nothing is sent to an outside AI company. The model receives only the question and the selected course passages, never a user ID. |
| **Transparency** | Every answer says whether it is AI-generated or a keyword search, and which sources it used. |
| **Session data in the browser** | The sign-in token is kept in `sessionStorage`, so it is removed when the tab closes. |

### A4. Known gaps (honest list)

| Gap | Risk | Planned fix |
|---|---|---|
| No endpoint for a student to delete their own questions (right to erasure, s.33) | Deletion must currently be done manually by an admin in D1 | `DELETE /v1/me/questions/:id`, cascading to answers, citations, feedback and replies (the foreign keys already use `ON DELETE CASCADE`) |
| No automatic retention period | Questions are kept indefinitely | Delete questions older than one academic term with a scheduled job |
| The browser keeps up to 50 recent questions per user in `localStorage` for "My questions" details | On a shared computer the next user of that browser profile could read them | Move to `sessionStorage`, or clear on sign-out |
| Students may type personal information into free text | Stored like any question | A notice on the Ask form: "Don't include personal information" |

---

## Part B — Security controls (with evidence)

### B1. Controls in place

| Threat (OWASP Top 10) | Control | Where |
|---|---|---|
| **A01 Broken access control** | `requireAuth` on every non-public route. `requireRole` for instructor-only routes. Ownership check so a student can read only their own question or rate only their own answer | [src/middleware/auth.ts](../../src/middleware/auth.ts), [src/routes/questions.ts](../../src/routes/questions.ts), [src/routes/feedback.ts](../../src/routes/feedback.ts) |
| **A07 Authentication failures** | Tokens are verified by Team 01 on every request (cached for at most 60 s, never past the token's expiry). Edited or expired tokens are rejected. If the identity service is down we return `503`, never let the user in | [src/services/identity-client.ts](../../src/services/identity-client.ts) |
| **A03 Injection: SQL** | Every query uses bound parameters (`?` with `.bind()`). The only dynamic SQL is `UPDATE … SET`, whose column names come from a fixed allowlist | [src/repositories/](../../src/repositories/) |
| **A03 Injection: XSS** | The UI renders all data with `textContent`; `innerHTML` is never used. Only `http(s)` URLs become links (`safeUrl`), which blocks `javascript:` URLs | [public/app.js](../../public/app.js) |
| **A03 Injection: prompt injection** | Course passages go to the model as delimited **data**; the instructions are only in a fixed system prompt. The output must be JSON and may cite only the passages we sent. Anything else is rejected and the keyword fallback is used | [src/services/ai-answer-service.ts](../../src/services/ai-answer-service.ts) |
| **A05 Security misconfiguration** | Strict Content-Security-Policy (scripts, styles and API calls from our origin + Team 01 only), `X-Frame-Options: DENY` (clickjacking), `nosniff`, `Referrer-Policy: no-referrer`, camera/microphone/location disabled | [public/_headers](../../public/_headers) |
| **A04 Insecure design: abuse and cost** | Input limits: question 3–1000 characters, comment ≤ 500, rating an integer 1–5, file ≤ 25 MB. Per-course daily AI budget. AI cut off after 15 s | [src/lib/constants.ts](../../src/lib/constants.ts), [wrangler.jsonc](../../wrangler.jsonc) |
| **A09 Logging and monitoring** | One structured JSON log line per request with a correlation ID, route, role, status and duration. No personal content. A deep health check reports dependency status | [src/middleware/request-logger.ts](../../src/middleware/request-logger.ts), `GET /v1/health/ready` |
| **Error leakage** | One error shape `{error: {code, message, correlationId}}`. Unexpected errors return a generic 500, and the stack trace goes only to the server log | [src/index.ts](../../src/index.ts) |
| **Secrets** | No secrets in the repo. `.dev.vars.example` holds placeholder names only; real values are Cloudflare secrets | [.dev.vars.example](../../.dev.vars.example) |

### B2. Evidence: controls tested against the running app (2026-11-10)

Run against the Worker locally (`npm run dev:local`) with curl:

| Attack / misuse | Request | Result |
|---|---|---|
| Student tries an instructor action | `POST /v1/sources` as a student | **403** |
| Student reads another student's question | `GET /v1/questions/:id` as `student-b` (question owned by `student-a`) | **403** `{"code":"FORBIDDEN","message":"You do not have access to this question."}` |
| No sign-in | `GET /v1/questions/:id` with no credentials | **401** `{"code":"UNAUTHORIZED","message":"Authentication is required."}` |
| Malformed input | `POST /v1/questions` with an invalid body | **400** `{"code":"VALIDATION_ERROR", …}` |
| Clickjacking / script injection | `GET /` response headers | `content-security-policy: default-src 'self'; script-src 'self'; … frame-ancestors 'none'` and `x-frame-options: DENY` |

Automated tests that guard these controls (all passing; see
[testing-and-ai-usage.md](testing-and-ai-usage.md)):

- `test/identity-auth.test.ts`: forged, edited and expired tokens rejected; 503 when Team 01 is down
- `test/routes-auth-and-validation.test.ts`: students cannot create, update or archive sources; malformed JSON, out-of-range ratings and too-short or too-long questions rejected before reaching the database
- `test/question-authorization.test.ts`: a student cannot view another student's question
- `test/feedback.test.ts`: one rating per user; only the owner or an instructor can rate
- `test/ai-answer-service.test.ts`: model output that cites passages we did not send is rejected

### B3. How to show it live

```bash
curl -i https://learning-assistant-api.6731503060.workers.dev/v1/me -H "Authorization: Bearer not-a-real-token"
```
Expected: `401`, invalid sign-in.

```bash
curl -I https://learning-assistant-api.6731503060.workers.dev/
```
Expected: the CSP and `X-Frame-Options: DENY` headers.

Signed in as a student in the UI, open a question ID that belongs to someone else in
"Open a question by ID". Expected: "You do not have access to this question."
