import { createRequire } from 'node:module'

/**
 * Minimal SQLite abstraction so the FTS5 provider does not depend directly on
 * better-sqlite3's API. A future node:sqlite adapter can implement the same
 * SqliteDriver interface and drop in without touching the provider.
 */

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqliteDriver {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  /** Wrap fn so all its statements run inside one transaction. */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  close(): void
}

// better-sqlite3 is an optional native dependency. createRequire keeps it a
// runtime require (never statically bundled) so the module loads only when the
// addon is actually present.
const nodeRequire = createRequire(import.meta.url)

/**
 * Load the better-sqlite3-backed driver for a database file.
 *
 * Returns null (never throws) if better-sqlite3 cannot be required or the
 * native addon is missing, so callers can degrade to the naive provider.
 */
export function loadSqliteDriver(dbPath: string): SqliteDriver | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional native module, untyped at the require boundary
    const Database: any = nodeRequire('better-sqlite3')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => db.prepare(sql) as SqliteStatement,
      transaction: ((fn: (...args: never[]) => unknown) =>
        db.transaction(fn)) as SqliteDriver['transaction'],
      close: () => db.close(),
    }
  } catch {
    return null
  }
}
