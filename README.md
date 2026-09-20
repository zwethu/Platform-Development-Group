# Learning Assistant API

Minimal Cloudflare Worker (Hono + TypeScript) scaffold for Assignment 3.
Implements only a versioned health check; all other routes will be added
incrementally per `PRD.md`.

## Prerequisites

- Node.js 18+ (developed against Node 24)
- npm
- A Cloudflare account — **not required yet**; only needed for a future
  assignment when we deploy or provision D1/R2

## Install

```
npm install
```

## Run locally

```
npm run dev
```

This starts `wrangler dev`, which runs the Worker entirely locally — no
Cloudflare account, login, or network dependency is required. By default
it listens on `http://127.0.0.1:8787`.

## Test the health endpoint

With the dev server running:

```
curl http://127.0.0.1:8787/v1/health
```

Expected response (`200`):

```json
{ "status": "ok", "service": "learning-assistant" }
```

Or run the automated test suite, which exercises the same route directly
through Hono without needing the dev server or any Cloudflare resource:

```
npm test
```

## Cloudflare D1 — not yet configured

This scaffold intentionally does **not** create or bind a D1 database.
When a future assignment introduces persistence:

1. `npx wrangler login`
2. `npx wrangler d1 create <database-name>`
3. Add the returned `database_id` to a `d1_databases` binding in
   `wrangler.jsonc`
4. Add migration SQL files under `migrations/`
5. `npx wrangler d1 migrations apply <database-name> --local` (and
   `--remote` for production)

See `PRD.md` §8 and §14 for the target schema and migration policy.

## Project layout

- `src/index.ts` — Hono app entry, mounts `/v1` routes
- `src/routes/` — route modules
- `src/lib/http-error.ts` — shared JSON error helper for future routes
- `migrations/` — reserved for future D1 migration SQL
- `test/` — Vitest tests
