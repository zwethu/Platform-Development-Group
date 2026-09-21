// Ambient augmentation of the generated Worker `Env` type
// (worker-configuration.d.ts, produced by `npx wrangler types` from the
// bindings in wrangler.jsonc) — adds non-binding environment variables
// that aren't declared there.
//
// This only declares a TYPE. It never sets the actual value. Provide the
// real value via `.dev.vars` locally (copy .dev.vars.example) and via
// `wrangler secret put INTERNSHIP_WEBHOOK_SECRET` for the deployed Worker.
// Never commit a real secret value.

declare global {
  interface Env {
    /** HMAC-SHA-256 secret for verifying POST /v1/webhooks/internship signatures. */
    INTERNSHIP_WEBHOOK_SECRET?: string

    /**
     * Shared secret Team 17 gave us for their `X-Webhook-Secret` header,
     * sent on outbound calls from POST /v1/integrations/team17/test-send to
     * their `/api/webhooks/partner` receiver. Never logged, stored, or
     * returned in any response.
     */
    TEAM17_OUTBOUND_WEBHOOK_SECRET?: string

    /**
     * Gates the Assignment-5-only routes under /v1/integrations/team17/*
     * (test-send, deliveries) via the X-Integration-Test-Key header. Not a
     * partner-facing secret — this protects our own test/evidence tooling.
     */
    INTEGRATION_TEST_KEY?: string
  }
}

export {}
