// Load test for POST /v1/questions (Week 12 lab task 3/4).
// Sends N questions with C in flight, records every request's latency, and
// appends one summary row to docs/week12-handover/p95_Proof.csv.
//
// Usage: node scripts/load-test.mjs <label> [baseUrl] [requests] [concurrency]
// Run against `npm run dev:local` only (local D1; real Workers AI quota is used).

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'

const [label = 'run', BASE = 'http://127.0.0.1:8787', nArg = '100', cArg = '5'] = process.argv.slice(2)
const N = Number(nArg)
const C = Number(cArg)
const BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 5000)
const OUT = new URL('../docs/week12-handover/', import.meta.url)

// Realistic student questions for course 1305308: most covered by the seeded
// sources, a few not covered (no-source path).
const QUESTIONS = [
  'What is a deep health check?',
  'How should webhooks be secured between platforms?',
  'What is contract-first API design?',
  'Why do we version the API path?',
  'What is the difference between authentication and authorization?',
  'How do I protect against prompt injection?',
  'What are the Big Three metrics?',
  'What is a performance budget?',
  'What should an incident runbook contain?',
  'When is the final exam?',
  'What is retrieval augmented generation?',
  'Why should migrations be additive?',
  'What is an idempotency key for?',
  'What is a quality gate in CI?',
  'What does an AI-native capability need?',
  'How do I start the lab environment with docker?',
  'What is a trust boundary?',
  'Which indexes should a table have?',
  'Who won the football match yesterday?',
  'What is the capital of France?',
]

const rows = []
let next = 0
async function worker(w) {
  while (next < N) {
    const i = next++
    const started = performance.now()
    let status = 0, mode = '', reason = '', correlationId = ''
    try {
      const res = await fetch(`${BASE}/v1/questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': `load-student-${w}`, 'x-user-role': 'student' },
        body: JSON.stringify({ courseId: '1305308', questionText: QUESTIONS[i % QUESTIONS.length] }),
      })
      status = res.status
      correlationId = res.headers.get('x-correlation-id') ?? ''
      const body = await res.json()
      mode = body?.data?.generation?.mode ?? ''
      reason = body?.data?.generation?.fallbackReason ?? ''
    } catch {
      status = 0
    }
    rows.push({ i, correlationId, status, latencyMs: Math.round(performance.now() - started), mode, reason })
    if (rows.length % 20 === 0) console.log(`  ${rows.length}/${N}`)
  }
}

const pct = (sorted, p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]

console.log(`Load test "${label}": ${N} requests, concurrency ${C} -> ${BASE}`)
const t0 = performance.now()
await Promise.all(Array.from({ length: C }, (_, w) => worker(w)))
const seconds = (performance.now() - t0) / 1000

rows.sort((a, b) => a.i - b.i)
const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b)
const ok = rows.filter((r) => r.status === 201).length
const count = (f) => rows.filter(f).length
const p95 = pct(lat, 95)
const summary = {
  timestamp: new Date().toISOString(),
  label,
  requests: N,
  concurrency: C,
  success_rate: (ok / N).toFixed(3),
  error_rate: ((N - ok) / N).toFixed(3),
  ai_answers: count((r) => r.mode === 'ai'),
  fallback_answers: count((r) => r.mode === 'fallback' && r.reason !== 'not_covered'),
  no_source_answers: count((r) => r.reason === 'not_covered'),
  mean_ms: Math.round(lat.reduce((a, b) => a + b, 0) / N),
  p50_ms: pct(lat, 50),
  p95_ms: p95,
  p99_ms: pct(lat, 99),
  max_ms: lat[lat.length - 1],
  throughput_rps: (N / seconds).toFixed(2),
  budget_ms: BUDGET_MS,
  result: p95 <= BUDGET_MS ? 'PASS' : 'FAIL',
}

mkdirSync(new URL('loadtest/', OUT), { recursive: true })
writeFileSync(
  new URL(`loadtest/${label}-requests.csv`, OUT),
  'i,correlation_id,status,latency_ms,mode,fallback_reason\n' +
    rows.map((r) => [r.i, r.correlationId, r.status, r.latencyMs, r.mode, r.reason].join(',')).join('\n') + '\n',
)
const proof = new URL('p95_Proof.csv', OUT)
if (!existsSync(proof)) writeFileSync(proof, Object.keys(summary).join(',') + '\n')
appendFileSync(proof, Object.values(summary).join(',') + '\n')

console.log(`
Load Test Summary (${label})
  Requests:        ${N} (concurrency ${C}, ${seconds.toFixed(1)} s, ${summary.throughput_rps} req/s)
  Success rate:    ${((100 * ok) / N).toFixed(1)}%
  Answered by:     AI ${summary.ai_answers} / fallback ${summary.fallback_answers} / no-source ${summary.no_source_answers}
  Mean / median:   ${summary.mean_ms} / ${summary.p50_ms} ms
  p95 latency:     ${p95} ms (${summary.result}, budget ${BUDGET_MS} ms)
  p99 / max:       ${summary.p99_ms} / ${summary.max_ms} ms`)
