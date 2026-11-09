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

    /**
     * "identity" (default): users sign in with Student Identity (Team 01) and
     * send its Bearer token. "demo-headers": the unsigned x-user-id /
     * x-user-role headers — offline local development and tests only.
     */
    AUTH_MODE?: string

    /** Student Identity base URL (plain var). Defaults to their production service. */
    IDENTITY_API_BASE?: string

    /**
     * Comma-separated Student Identity subjects (student IDs) that act as
     * instructors in the Learning Assistant. Set as a secret
     * (`wrangler secret put INSTRUCTOR_IDS`) so student IDs never land in git.
     */
    INSTRUCTOR_IDS?: string
  }
}

export {}
