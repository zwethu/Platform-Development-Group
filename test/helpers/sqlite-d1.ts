// A D1Database backed by a real in-memory SQLite database (Node's built-in
// node:sqlite), with every file in migrations/ applied in order.
//
// Unlike the purpose-built fakes in the other tests, this runs the
// repositories' real SQL — joins, subqueries, CHECK and FOREIGN KEY
// constraints, RETURNING — so a schema or query mistake fails the test.
// Only the D1 methods this codebase uses are implemented.

import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

// Loaded at runtime: Vite's resolver does not know the newer `node:sqlite` builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
type DatabaseSync = DatabaseSyncType

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

type Value = string | number | bigint | null | Uint8Array

function toSqlValue(value: unknown): Value {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value as Value
}

class Statement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...args: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, args.map(toSqlValue))
  }

  /** Rows for SELECT / RETURNING; for other statements the change count. */
  execute(): { results: Record<string, unknown>[]; changes: number } {
    const stmt = this.sqlite.prepare(this.sql)
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      return { results: stmt.all(...this.params) as Record<string, unknown>[], changes: 0 }
    }
    const info = stmt.run(...this.params)
    return { results: [], changes: Number(info.changes) }
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.execute().results[0]
    if (!row) return null
    return (column ? row[column] : { ...row }) as T
  }

  async all<T>() {
    const { results } = this.execute()
    return { success: true, results: results.map((r) => ({ ...r })) as T[], meta: {} }
  }

  async run() {
    const { results, changes } = this.execute()
    return { success: true, results, meta: { changes } }
  }
}

export function createSqliteD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  const db = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    /** Like D1: all statements succeed together or none are applied. */
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try {
        const out = statements.map((s) => {
          const { results, changes } = s.execute()
          return { success: true, results, meta: { changes } }
        })
        sqlite.exec('COMMIT')
        return out
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
  }

  /** Direct SQL access for assertions. */
  const query = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
    sqlite.prepare(sql).all(...params.map(toSqlValue)) as T[]

  return { db: db as unknown as D1Database, query }
}
