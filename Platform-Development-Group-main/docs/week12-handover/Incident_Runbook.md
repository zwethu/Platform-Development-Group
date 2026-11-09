# Incident Runbook — Learning Assistant API (Team 08)

**Service:** Worker `learning-assistant-api` · D1 `learning-assistant-db` · Workers AI
**First URL to open:** `https://<worker-url>/v1/health/ready` (local: `http://127.0.0.1:8787/v1/health/ready`)
**Logs:** Cloudflare dashboard → Workers → learning-assistant-api → Logs, or `npx wrangler tail --format json`

## 1. Symptoms (start this runbook when any of these is true)

| Signal | Normal | Alert |
|---|---|---|
| `/v1/health/ready` | 200 `"ok"` | 503 `"degraded"` (AI down) or `"down"` (database) |
| HTTP 5xx in `http_request` logs | 0 | > 1% of requests in 5 min |
| `POST /v1/questions` p95 (`durationMs`) | ~0.8 s | > 5 s (our budget) |
| `ai_answer` logs with `mode: "fallback"` | ~5% | > 50% for 10 min |
| Student report | — | "every answer says *keyword search*" or "answers are slow" |

## 2. Diagnostics (about 3 min)

1. `curl -s <url>/v1/health/ready?probe=ai | jq '.status, .checks'` — which check is `fail`?
   - `database` fail → **3A**. `ai` fail → **3B**. `ai_budget` warn/fail → **3C**.
2. Was there a deploy in the last hour? `npx wrangler deployments list` → if yes and errors started after it, **3D first**.
3. Follow one bad request: copy `x-correlation-id` from the response header, then search the logs for that `correlationId`. The `ai_answer` line gives `fallbackReason` and `error`; an `unhandled_error` line gives the stack.
4. Fallback reasons: `timeout` / `model_error` = Workers AI problem · `over_budget` = our daily cap · `invalid_output` / `invalid_citation` = model quality (expected ~5%) · `disabled` = `AI_ENABLED` is not `"true"`.

## 3. Mitigation (stabilise first, find the root cause later)

When AI fails, students **still get answers** from the keyword fallback (201, `mode: "fallback"`). That means the service is degraded, not down. Do not roll back the database for an AI problem.

- **3A Database down / missing table:** `npx wrangler d1 migrations list learning-assistant-db --remote`. Apply any that are missing with `npx wrangler d1 migrations apply learning-assistant-db --remote`. If D1 itself is down, check status.cloudflare.com and escalate.
- **3B Workers AI failing or slow:** set `AI_ENABLED` to `"false"` in `wrangler.jsonc` and run `npx wrangler deploy`. This makes every request use the fallback right away (fast and predictable). Turn AI back on when `?probe=ai` passes again.
- **3C Neuron quota (`3036` errors) or our budget reached:** nothing breaks; the fallback answers until 00:00 UTC. If it happens every day, lower the traffic or ask the team to review `AI_DAILY_BUDGET_PER_COURSE`.
- **3D Bad deploy (errors right after release):** `npx wrangler rollback`. Migrations are additive, so the code rollback alone is safe (PRD §14.4). Then confirm `/v1/health/ready` returns 200.

## 4. Escalation

| After | If | Contact |
|---|---|---|
| 15 min | not mitigated by step 3 | Backend/DB: Thaw Zin Myo Aung · Delivery: Zwe Thura Aung (Team 08 MS Teams channel) |
| 30 min | still `down`, or any sign of data exposure in logs | Quality & Security: Sai Aung Kham, and the instructor, Aj. Vittayasak (vittayasak@mfu.ac.th) |
| Any time | Cloudflare platform outage | status.cloudflare.com — wait, and keep students informed |

**After the incident:** write down the start and end time, one affected `correlationId`, the cause, the fix, and one action to prevent it happening again.
