import { Hono } from 'hono'
import type { AppEnv } from '../lib/app-env'
import { getDb } from '../lib/db'
import { aiInvocationsToday } from '../repositories/ai-usage-repository'

export const health = new Hono<AppEnv>()

/** Liveness: the Worker is running. Unchanged contract — kept for existing callers and tests. */
health.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'learning-assistant' }, 200)
})

// Every table the app needs, one or more per migration: ai_usage proves 0003,
// source_chunks + instructor_replies prove 0004, courses proves 0005.
const REQUIRED_TABLES = [
  'knowledge_sources',
  'questions',
  'answers',
  'citations',
  'answer_feedback',
  'ai_usage',
  'source_chunks',
  'instructor_replies',
  'courses',
]

type Check = { status: 'pass' | 'warn' | 'fail'; latencyMs: number; detail?: unknown; error?: string }

async function timed(fn: () => Promise<{ status?: 'pass' | 'warn'; detail: unknown }>): Promise<Check> {
  const started = Date.now()
  try {
    const { status = 'pass', detail } = await fn()
    return { status, latencyMs: Date.now() - started, detail }
  } catch (err) {
    return { status: 'fail', latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Readiness / deep health (Week 12 lab task 2). Checks the real dependencies
 * of the question path instead of answering "ok" blindly:
 *
 *  - database      D1 answers a query and every required table exists
 *  - ai            Workers AI binding configured and enabled; today's usage.
 *                  `?probe=ai` also makes one tiny real model call (uses quota).
 *  - ai_budget     per-course daily cap still has room (warn near the cap)
 *
 * status: "ok" (200) | "degraded" (503: AI unavailable, questions still answered
 * by the keyword fallback) | "down" (503: database unusable, questions fail).
 * Never returns secrets, row contents or user data.
 */
health.get('/health/ready', async (c) => {
  const env = c.env
  const database = await timed(async () => {
    const db = getDb(env)
    const { results } = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`)
      .bind(...REQUIRED_TABLES)
      .all<{ name: string }>()
    const missing = REQUIRED_TABLES.filter((t) => !results.some((r) => r.name === t))
    if (missing.length > 0) throw new Error(`missing tables (migrations not applied?): ${missing.join(', ')}`)
    return { detail: { tables: REQUIRED_TABLES.length } }
  })

  const ai = await timed(async () => {
    if (!env?.AI) throw new Error('Workers AI binding "AI" is not configured')
    if (env.AI_ENABLED !== 'true') throw new Error('AI_ENABLED is not "true" (fallback only)')
    if (c.req.query('probe') === 'ai') {
      await env.AI.run(env.AI_MODEL as keyof AiModels, { messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 2 } as never)
      return { detail: { model: env.AI_MODEL, probe: 'pass' } }
    }
    return { detail: { model: env.AI_MODEL, probe: 'skipped (add ?probe=ai)' } }
  })

  const aiBudget = await timed(async () => {
    const used = await aiInvocationsToday(getDb(env))
    const perCourse = Number(env.AI_DAILY_BUDGET_PER_COURSE)
    return { status: used >= perCourse * 0.8 ? 'warn' : 'pass', detail: { invocationsToday: used, dailyBudgetPerCourse: perCourse } }
  })

  const checks = { database, ai, ai_budget: aiBudget }
  const status = database.status === 'fail' ? 'down' : ai.status === 'fail' || aiBudget.status === 'fail' ? 'degraded' : 'ok'
  return c.json(
    {
      status,
      service: 'learning-assistant',
      answerPath: status === 'ok' ? 'ai_with_fallback' : status === 'degraded' ? 'keyword_fallback_only' : 'unavailable',
      checks,
      timestamp: new Date().toISOString(),
    },
    status === 'ok' ? 200 : 503,
  )
})
