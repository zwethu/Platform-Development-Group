# A5 — Team 08 Integration Evidence

| Field | Value |
|---|---|
| Team | Team 08 — Learning Assistant |
| Partner | Team 17 — Internship Management |
| Team 08 base API | `https://learning-assistant-api.expense-tracker-api.workers.dev` |
| Team 17 base API | `https://team17-internship.vercel.app` |
| Submission date | 2026-09-21 |

This document is the Assignment 5 (Interface Between Groups) evidence
record for the Team 08 ↔ Team 17 integration. Every **Actual Result**,
**Timestamp**, and **Status** field below is `TODO` until the
corresponding request is actually run against the **deployed** endpoints
and the matching screenshot is added to `docs/evidence/` (see
`docs/evidence/README.md` for the exact required filenames). Nothing in
this document should be filled in with a fabricated response body,
timestamp, database record, or partner confirmation — only with what was
actually observed.

**Note:** a local (non-production) dry run of the receiver, idempotency,
and outbound-failure-handling logic was previously exercised against a
local dev server and local database earlier in this repository's
development history, as a design/implementation check. It is **not**
evidence for this document — every section below requires a fresh result
captured against the deployed endpoints listed above.

**Redaction rule:** this document and every screenshot must never contain
a real HMAC signature, `X-Webhook-Signature` value, `X-Webhook-Secret`
value, `X-Integration-Test-Key` value, or any Cloudflare secret. Use
`[REDACTED]` wherever such a value would otherwise appear.

For the full endpoint/payload contract reference, see
`docs/team17-integration-contract.md`.

---

## 1. Consumer Proof

**What this proves:** Team 08 can successfully call Team 17's public
status endpoint as a consumer of Team 17's API.

| | |
|---|---|
| Endpoint | `GET https://team17-internship.vercel.app/api/integration/status` |
| Method | GET |
| Required headers | None |
| Expected Result | HTTP 200, JSON body with Team 17's service status |
| Actual Result | TODO |
| Timestamp | TODO |
| Status (PASS/FAIL/TODO) | TODO |

![Consumer Proof](evidence/01-consumer-team17-status.png)

| Evidence item | Present? |
|---|---|
| Request timestamp visible | TODO |
| HTTP status code visible | TODO |
| Full JSON response body visible | TODO |

---

## 2. Provider Proof

**What this proves:** Team 17 can successfully call Team 08's public
status endpoint as a consumer of Team 08's API.

| | |
|---|---|
| Endpoint | `GET https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integration/status` |
| Method | GET |
| Required headers | None |
| Expected Result | HTTP 200, JSON body with Team 08's service status |
| Actual Result | TODO |
| Timestamp | TODO |
| Partner (Team 17) confirmation | TODO |
| Status (PASS/FAIL/TODO) | TODO |

![Provider Proof](evidence/02-provider-team08-status.png)

| Evidence item | Present? |
|---|---|
| Request timestamp visible | TODO |
| HTTP status code visible | TODO |
| Full JSON response body visible | TODO |
| Team 17 confirmation captured (message, screenshot, or log on their side) | TODO |

---

## 3. Webhook Receiver

**What this proves:** Team 08's inbound webhook receiver correctly
authenticates and accepts a validly signed event from Team 17.

**Inbound payload contract (exact):**

```json
{
  "eventId": "team17-internship-a5-001",
  "type": "internship.opportunity.published",
  "occurredAt": "2026-09-21T09:00:00.000Z",
  "source": "team-17-internship",
  "subject": "opportunity:int-a5-001",
  "data": {
    "opportunityId": "int-a5-001",
    "title": "Software Engineering Internship",
    "companyName": "Demo Technology Co.",
    "description": "Assignment 5 cross-team integration test.",
    "requirements": ["Resume", "GitHub profile"],
    "applicationDeadline": "2026-10-15T16:59:00.000Z",
    "url": "https://team17-internship.vercel.app"
  }
}
```

| | |
|---|---|
| Endpoint | `POST https://learning-assistant-api.expense-tracker-api.workers.dev/v1/webhooks/internship` |
| Method | POST |
| Required headers | `Content-Type: application/json`, `X-Webhook-Signature: [REDACTED]` |
| Expected Result | HTTP 202, `{ "data": { "eventId": "...", "status": "accepted", "knowledgeSourceId": "..." } }` |
| Actual Result | TODO |
| Timestamp | TODO |
| Status (PASS/FAIL/TODO) | TODO |

![Webhook Receiver — First Event](evidence/03-webhook-receiver-first-event.png)

**Remote D1 storage proof** — query commands to run (no secret required for
these; D1 access uses your authenticated `wrangler` session, not the
webhook secret):

```bash
npx wrangler d1 execute learning-assistant-db --remote --command \
  "SELECT event_id, event_type, source, processing_status FROM received_events WHERE event_id = 'team17-internship-a5-001';"

npx wrangler d1 execute learning-assistant-db --remote --command \
  "SELECT id, course_id, title, status, created_by FROM knowledge_sources WHERE created_by = 'team-17-internship' ORDER BY created_at DESC LIMIT 5;"
```

| Evidence item | Present? |
|---|---|
| `received_events` row for this `eventId` | TODO |
| `knowledge_sources` row created from this event | TODO |
| Secret/signature redacted in screenshot | TODO |

![Webhook Receiver — D1 Storage](evidence/04-webhook-receiver-d1-storage.png)

---

## 4. Webhook Sender

**What this proves:** Team 08 can successfully send an outbound webhook to
Team 17's partner receiver through its own protected internal test route,
and Team 17 accepts it.

| | |
|---|---|
| Sender endpoint (Team 08, internal) | `POST https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integrations/team17/test-send` |
| Required headers (sender call) | `X-Integration-Test-Key: [REDACTED]` |
| Destination (Team 17) | `POST https://team17-internship.vercel.app/api/webhooks/partner` |
| Destination auth (redacted in any screenshot) | `X-Webhook-Secret: [REDACTED]` |
| Delivery log endpoint | `GET https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integrations/team17/deliveries` (also `X-Integration-Test-Key: [REDACTED]`) |
| Expected Result | Sender call returns HTTP 200 with `status: "delivered"`; Team 17 accepts the payload |
| Actual Result | TODO |
| Timestamp | TODO |
| Status (PASS/FAIL/TODO) | TODO |

![Webhook Sender — Team 17 Response](evidence/08-webhook-sender-team17-response.png)

| Evidence item | Present? |
|---|---|
| Sender call HTTP status shown | TODO |
| Team 17's response body shown (no secret visible) | TODO |
| `X-Integration-Test-Key` and `X-Webhook-Secret` both redacted | TODO |
| Delivery recorded via `GET .../deliveries` with `status: "delivered"` | TODO |

---

## 5. Idempotency Proof

**What this proves:** replaying the same `eventId` to the webhook receiver
does not create a second record.

**Idempotency expectations:**
- First valid `eventId` → HTTP 202, exactly one `received_events` row and
  one `knowledge_sources` row created.
- Same `eventId` again → HTTP 200 with `duplicate: true`, no second
  creation.

| Request | Endpoint | Expected Result | Actual Result | Timestamp | Status |
|---|---|---|---|---|---|
| 1st request (new `eventId`) | `POST /v1/webhooks/internship` | HTTP 202, `status: "accepted"` | TODO | TODO | TODO |
| 2nd request (same `eventId`, replayed) | `POST /v1/webhooks/internship` | HTTP 200, `status: "duplicate", "duplicate": true` | TODO | TODO | TODO |

![Idempotency — First Request](evidence/05-idempotency-first-request.png)

![Idempotency — Duplicate Request](evidence/06-idempotency-duplicate-request.png)

**Remote D1 single-creation proof:**

```bash
npx wrangler d1 execute learning-assistant-db --remote --command \
  "SELECT COUNT(*) AS event_count FROM received_events WHERE event_id = '<eventId used above>';"

npx wrangler d1 execute learning-assistant-db --remote --command \
  "SELECT COUNT(*) AS source_count FROM knowledge_sources WHERE created_by = 'team-17-internship' AND source_url = '<url used above>';"
```

| Evidence item | Expected | Actual | Status |
|---|---|---|---|
| `received_events` row count for this `eventId` | 1 | TODO | TODO |
| `knowledge_sources` row count created from this event | 1 | TODO | TODO |

![Idempotency — Single Creation](evidence/07-idempotency-single-creation.png)

---

## 6. Degradation Proof

**What this proves:** a Team 17 endpoint failure is handled safely (no
crash, no secret leak, attempt recorded) and Team 08 recovers automatically
once Team 17 is reachable again.

**Degradation expectations:**
- Failed Team 17 response or network failure → Team 08 logs the outbound
  delivery as `failed` and returns a safe HTTP 502 error JSON (no secret,
  no stack trace).
- Successful retry after recovery → Team 08 records the outbound delivery
  as `delivered`.

| Scenario | Endpoint | Expected Result | Actual Result | Timestamp | Status |
|---|---|---|---|---|---|
| Controlled failure | `POST /v1/integrations/team17/test-send` | HTTP 502, `{ "error": { "code": "PARTNER_WEBHOOK_DELIVERY_FAILED", "message": "...", "deliveryId": "...", "partnerStatus": ... } }`, delivery logged `failed` | TODO | TODO | TODO |
| Recovery / retry | `POST /v1/integrations/team17/test-send` | HTTP 200, delivery logged `delivered` | TODO | TODO | TODO |

![Degradation — Failure](evidence/09-degradation-failure.png)

![Degradation — Recovery](evidence/10-degradation-recovery.png)

| Evidence item | Present? |
|---|---|
| Failure response shows no secret/stack trace | TODO |
| Failed delivery visible in `GET .../deliveries` | TODO |
| Recovery delivery visible as `delivered` in `GET .../deliveries` | TODO |

---

## Final Checklist

Before this document is submitted, confirm all of the following:

- [ ] `01-consumer-team17-status.png` added to `docs/evidence/`
- [ ] `02-provider-team08-status.png` added to `docs/evidence/`
- [ ] `03-webhook-receiver-first-event.png` added to `docs/evidence/`
- [ ] `04-webhook-receiver-d1-storage.png` added to `docs/evidence/`
- [ ] `05-idempotency-first-request.png` added to `docs/evidence/`
- [ ] `06-idempotency-duplicate-request.png` added to `docs/evidence/`
- [ ] `07-idempotency-single-creation.png` added to `docs/evidence/`
- [ ] `08-webhook-sender-team17-response.png` added to `docs/evidence/`
- [ ] `09-degradation-failure.png` added to `docs/evidence/`
- [ ] `10-degradation-recovery.png` added to `docs/evidence/`
- [ ] Both D1 proof queries (§3 webhook-receiver storage, §5 idempotency
      single-creation) captured against the **remote** database
- [ ] All secrets/signatures/keys redacted in every screenshot and in this
      document (`[REDACTED]` used consistently)
- [ ] All six assignment sections (Consumer, Provider, Webhook Receiver,
      Webhook Sender, Idempotency, Degradation) have Actual Result,
      Timestamp, and Status filled in
- [ ] No remaining `TODO` fields anywhere in this document
