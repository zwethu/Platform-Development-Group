// Minimal declarations for the few Node.js APIs the SQLite test helper uses.
// The project deliberately has no @types/node: its globals clash with the
// Cloudflare Workers types the application code is checked against.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string): string[]
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare module 'node:module' {
  export function createRequire(from: string): (id: string) => unknown
}

declare module 'node:sqlite' {
  type SqlValue = string | number | bigint | null | Uint8Array
  export class StatementSync {
    all(...params: SqlValue[]): unknown[]
    get(...params: SqlValue[]): unknown
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }
  export class DatabaseSync {
    constructor(location: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
  }
}

interface ImportMeta {
  readonly url: string
}

declare const __dirname: string
