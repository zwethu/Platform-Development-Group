# Team 08 ↔ Team 17 Integration Contract

Assignment 5 (Interface Between Groups). Team 08 = Learning Assistant.
Team 17 = Internship Management. **Provisional development contract** —
subject to change once both teams formally confirm it.

## Team 08's endpoints (what Team 17 calls)

### Public status

```
GET https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integration/status
```

No headers required. Returns:

```json
{
  "data": {
    "service": "team-08-learning-assistant",
    "team": "Team 08",
    "status": "ok",
    "timestamp": "2026-09-21T08:00:00.000Z",
    "integration": {
      "partner": "team-17-internship",
      "inboundWebhook": "/v1/webhooks/internship"
    }
  }
}
```

### Inbound webhook receiver

```
POST https://learning-assistant-api.expense-tracker-api.workers.dev/v1/webhooks/internship
```

**Required headers:**

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Signature` | Hex-encoded HMAC-SHA-256 of the exact raw request body |

**Signature rule:** `X-Webhook-Signature` must be the lowercase hex HMAC-SHA-256
of the **exact raw JSON body text** (not a re-serialized copy), keyed with
the shared secret Team 08 and Team 17 exchange privately (never in chat,
commits, or this file). Verified with `crypto.subtle.verify` (constant-time
comparison) — see `src/lib/webhook-signature.ts`.

**Payload contract (camelCase):**

```json
{
  "eventId": "string",
  "type": "internship.opportunity.published",
  "occurredAt": "ISO 8601 string",
  "source": "team-17-internship",
  "subject": "opportunity:<id>",
  "data": {
    "opportunityId": "string",
    "title": "string",
    "companyName": "string",
    "description": "string",
    "requirements": ["string"],
    "applicationDeadline": "ISO 8601 string",
    "url": "valid URL"
  }
}
```

**Responses:**

| Case | Status | Body |
|---|---|---|
| Secret not configured on our side | 503 | `{ "error": { "code": "CONFIGURATION_ERROR", ... } }` |
| Missing/invalid signature | 401 | `{ "error": { "code": "UNAUTHORIZED", ... } }` — nothing persisted |
| Invalid/malformed payload | 400 | `{ "error": { "code": "VALIDATION_ERROR", ... } }` |
| Replayed `eventId` | 200 | `{ "data": { "eventId": "...", "status": "duplicate", "processed": false, "duplicate": true } }` — no second record created |
| New valid event | 202 | `{ "data": { "eventId": "...", "status": "accepted", "knowledgeSourceId": "..." } }` |

### Test procedure (local)

See README's "Team 17 Integration → Manual local test procedure" for the
full step-by-step (start `wrangler dev --local`, set a temporary
`.dev.vars` secret, compute an HMAC signature with `openssl`, send the
signed payload twice to confirm accept-then-duplicate behavior, verify via
`wrangler d1 execute --local`).

## Team 17's endpoints (what Team 08 calls)

### Public status

```
GET https://team17-internship.vercel.app/api/integration/status
```

### Webhook receiver

```
POST https://team17-internship.vercel.app/api/webhooks/partner
```

**Required headers:**

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Secret` | Plain shared secret (not HMAC-signed) |

**Payload contract:**

```json
{
  "event_id": "string",
  "event_type": "partner.updated",
  "occurred_at": "ISO 8601 string",
  "source": "team-08-learning-assistant",
  "data": {
    "resource_id": "string",
    "status": "string"
  }
}
```

Team 08 sends this via `POST /v1/integrations/team17/test-send` (see below)
— an internal, key-gated route, not part of the public API.

## Team 08's outbound test-send route (internal tooling)

```
POST https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integrations/team17/test-send
GET  https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integrations/team17/deliveries
```

Both routes require `X-Integration-Test-Key: <INTEGRATION_TEST_KEY>` — a
key Team 08 chooses locally for its own evidence tooling, **not** shared
with Team 17 and unrelated to any partner secret. Missing/wrong key → 401;
key not configured on the Worker → 503.

`test-send` generates `event_id`/`occurred_at` server-side, defaults
`data.resource_id`/`data.status` to `learning-assistant-demo-001`/`updated`
(both overridable via an optional JSON body with only those two fields —
anything else is rejected with 400), and POSTs to Team 17's
`/api/webhooks/partner` using the secret in the `TEAM17_OUTBOUND_WEBHOOK_SECRET`
binding. Never accepts a destination URL from the caller.

Every attempt — success or failure — is recorded in the
`outbound_webhook_deliveries` D1 table (`migrations/0002_outbound_webhook_deliveries.sql`).
The outbound secret and request headers are **never** stored there or
returned by `/deliveries`; only the outbound JSON payload, the partner's
response status/body, and delivery status/timestamps are kept.

On a non-2xx partner response or a network error, the delivery is logged
`status = 'failed'` and the route returns:

```json
{
  "error": {
    "code": "PARTNER_WEBHOOK_DELIVERY_FAILED",
    "message": "Team 17 webhook delivery failed. The delivery was recorded for retry.",
    "deliveryId": "<id>",
    "partnerStatus": 500
  }
}
```

(`partnerStatus` is `null` for a network-level failure, where no HTTP
response was ever received.)

## Secret-handling rule

- Real secret values (`INTERNSHIP_WEBHOOK_SECRET`, `TEAM17_OUTBOUND_WEBHOOK_SECRET`,
  `INTEGRATION_TEST_KEY`) are **never** committed to this repository, put in
  chat logs, or written into any `.md`/`.txt`/test file.
- Locally: copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill in
  real values there only.
- Deployed: `wrangler secret put <NAME>` — never in `wrangler.jsonc`.
- The two teams' secrets are exchanged privately and out-of-band (not
  through this repository, an issue tracker, or a shared chat channel).
