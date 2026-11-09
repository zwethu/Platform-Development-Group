import { describe, expect, it } from 'vitest'
import app from '../src/index'

const ALL_TABLES = [
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

/** D1 stub that answers only the two queries /v1/health/ready makes. */
function fakeDb({ tables = ALL_TABLES, invocationsToday = 0, broken = false } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async all() {
              if (broken) throw new Error('D1_ERROR: database unavailable')
              if (sql.includes('sqlite_master')) return { results: tables.map((name) => ({ name })) }
              throw new Error(`unexpected all(): ${sql}`)
            },
            async first() {
              if (broken) throw new Error('D1_ERROR: database unavailable')
              return { total: invocationsToday }
            },
          }
        },
      }
    },
  }
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    learning_assistant_db: fakeDb(),
    AI: { run: async () => ({ response: 'OK' }) },
    AI_ENABLED: 'true',
    AI_MODEL: '@cf/meta/llama-3.2-3b-instruct',
    AI_DAILY_BUDGET_PER_COURSE: '300',
    AI_TIMEOUT_MS: '15000',
    ...overrides,
  }
}

async function ready(e: Record<string, unknown>, query = '') {
  const res = await app.request(`/v1/health/ready${query}`, {}, e)
  return { status: res.status, body: (await res.json()) as any }
}

describe('GET /v1/health/ready (deep health)', () => {
  it('returns 200 ok when database, AI and budget all pass', async () => {
    const { status, body } = await ready(env())
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.answerPath).toBe('ai_with_fallback')
    expect(Object.keys(body.checks)).toEqual(['database', 'ai', 'ai_budget'])
  })

  it('only calls the model when ?probe=ai is given', async () => {
    let calls = 0
    const ai = { run: async () => ((calls += 1), { response: 'OK' }) }
    await ready(env({ AI: ai }))
    expect(calls).toBe(0)
    const { body } = await ready(env({ AI: ai }), '?probe=ai')
    expect(calls).toBe(1)
    expect(body.checks.ai.detail.probe).toBe('pass')
  })

  it('is degraded (503) when AI is disabled — questions still use the fallback', async () => {
    const { status, body } = await ready(env({ AI_ENABLED: 'false' }))
    expect(status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.answerPath).toBe('keyword_fallback_only')
    expect(body.checks.database.status).toBe('pass')
  })

  it('is degraded (503) when the AI probe fails', async () => {
    const ai = { run: async () => Promise.reject(new Error('3036: daily neuron limit reached')) }
    const { status, body } = await ready(env({ AI: ai }), '?probe=ai')
    expect(status).toBe(503)
    expect(body.checks.ai.error).toMatch(/neuron limit/)
  })

  it('is down (503) when a migration is missing', async () => {
    const { status, body } = await ready(env({ learning_assistant_db: fakeDb({ tables: ALL_TABLES.slice(0, 5) }) }))
    expect(status).toBe(503)
    expect(body.status).toBe('down')
    expect(body.checks.database.error).toMatch(/ai_usage/)
  })

  it('is down (503) when the newest migrations (0004, 0005) are missing', async () => {
    const tables = ALL_TABLES.filter((t) => !['source_chunks', 'instructor_replies', 'courses'].includes(t))
    const { status, body } = await ready(env({ learning_assistant_db: fakeDb({ tables }) }))
    expect(status).toBe(503)
    expect(body.status).toBe('down')
    expect(body.checks.database.error).toMatch(/source_chunks, instructor_replies, courses/)
  })

  it('is down (503) when the database is unreachable', async () => {
    const { body } = await ready(env({ learning_assistant_db: fakeDb({ broken: true }) }))
    expect(body.status).toBe('down')
    expect(body.answerPath).toBe('unavailable')
  })

  it('warns when the AI budget is nearly used up', async () => {
    const { status, body } = await ready(env({ learning_assistant_db: fakeDb({ invocationsToday: 250 }) }))
    expect(status).toBe(200)
    expect(body.checks.ai_budget.status).toBe('warn')
  })
})
