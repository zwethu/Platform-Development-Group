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
  }
}

export {}
