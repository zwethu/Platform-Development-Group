-- Assignment 5 — outbound webhook delivery ledger for cross-team calls this
-- service makes to a partner (currently: Team 17 Internship's partner
-- webhook). Records every delivery attempt, success or failure, so
-- Assignment 5 evidence (and future retry logic) can be built from it.
-- Never stores the outbound secret or request headers — see
-- src/repositories/outbound-deliveries-repository.ts.

CREATE TABLE outbound_webhook_deliveries (
  id TEXT PRIMARY KEY,
  partner TEXT NOT NULL,
  event_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_payload_json TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  attempted_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX idx_outbound_webhook_deliveries_partner_attempted
  ON outbound_webhook_deliveries (partner, attempted_at);
CREATE INDEX idx_outbound_webhook_deliveries_event_id
  ON outbound_webhook_deliveries (event_id);
