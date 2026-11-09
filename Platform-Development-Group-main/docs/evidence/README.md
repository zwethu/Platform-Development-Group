# Evidence Screenshots

Required screenshots for `docs/A5-Team08-Integration-Evidence.md`. Add each
file to this folder using the exact filename below before submission. Every
screenshot must have secrets, HMAC signatures, webhook-secret headers, and
integration test keys redacted or cropped out.

1. **`01-consumer-team17-status.png`**
   Team 08 calls `GET https://team17-internship.vercel.app/api/integration/status`.
   Must show timestamp, HTTP status, and JSON response body.

2. **`02-provider-team08-status.png`**
   Team 17 calls `GET https://learning-assistant-api.expense-tracker-api.workers.dev/v1/integration/status`.
   Must show timestamp, HTTP status, response body, and Team 17 confirmation.

3. **`03-webhook-receiver-first-event.png`**
   Team 17 sends one valid signed event to `POST /v1/webhooks/internship`.
   Must show status 202 or the actual accepted result. Secret/signature must
   be redacted.

4. **`04-webhook-receiver-d1-storage.png`**
   Team 08 remote D1 query showing the stored received event and the
   created internship knowledge source.

5. **`05-idempotency-first-request.png`**
   First request with a specific `eventId` is accepted.

6. **`06-idempotency-duplicate-request.png`**
   Same request with exactly the same `eventId` returns duplicate behavior.
   Must show `duplicate: true` if the deployed API returns it.

7. **`07-idempotency-single-creation.png`**
   Remote D1 queries prove exactly one event and one corresponding
   knowledge source were created.

8. **`08-webhook-sender-team17-response.png`**
   Team 08 sends through its protected test route and Team 17 accepts the
   payload. All keys/secrets must be redacted.

9. **`09-degradation-failure.png`**
   Team 08 records a controlled Team 17 endpoint failure and a safe
   fallback/error response.

10. **`10-degradation-recovery.png`**
    Team 08 retries after the Team 17 endpoint is restored and records a
    successful delivery.
