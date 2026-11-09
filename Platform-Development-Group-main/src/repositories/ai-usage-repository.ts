// Per-course daily AI budget (PRD NFR-06). See migrations/0003_ai_usage_budget.sql.

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Takes one AI invocation from today's budget for the course.
 * Returns the new count, or null when the budget is already used up — the
 * caller must then use the deterministic fallback instead of calling the model.
 * The check and the increment are one SQL statement, so it is race-free.
 */
export async function tryConsumeAiBudget(
  db: D1Database,
  courseId: string,
  dailyBudget: number,
  day = utcDay(),
): Promise<number | null> {
  if (dailyBudget <= 0) return null
  const row = await db
    .prepare(
      `INSERT INTO ai_usage (day, course_id, invocations) VALUES (?, ?, 1)
       ON CONFLICT (day, course_id) DO UPDATE SET invocations = invocations + 1
       WHERE ai_usage.invocations < ?
       RETURNING invocations`,
    )
    .bind(day, courseId, dailyBudget)
    .first<{ invocations: number }>()
  return row ? row.invocations : null
}

/** Total AI invocations today across all courses (for /v1/health/ready). */
export async function aiInvocationsToday(db: D1Database, day = utcDay()): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(invocations), 0) AS total FROM ai_usage WHERE day = ?`)
    .bind(day)
    .first<{ total: number }>()
  return row?.total ?? 0
}
