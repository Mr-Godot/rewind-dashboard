import * as fs from 'node:fs'
import * as path from 'node:path'
import { getProjectsDir, extractSessionId } from '../utils/claude-path'
import { getCacheDir } from '../cache/disk-cache'
import { scanProjects } from '../scanner/project-scanner'
import { extractSearchBlocks, type SearchBlock } from './block-extractor'
import { loadSqliteDriver, type SqliteDriver, type SqliteStatement } from './sqlite-driver'
import {
  emptyIndexStats,
  type IndexStats,
  type SearchHit,
  type SearchProvider,
  type SearchQuery,
  type SearchResult,
  type BlockType,
} from './provider'

/** Bump to force a full drop + rebuild of the on-disk index. */
const SCHEMA_VERSION = 1
/** Minimum gap between filesystem rescans, unless force is passed. */
const DEFAULT_THROTTLE_MS = 5000
/** Snippet length, in tokens. */
const SNIPPET_TOKENS = 12
/** Cap on the number of FTS terms built from a single query. */
const MAX_QUERY_TERMS = 32

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS indexed_files (
  session_id TEXT PRIMARY KEY,
  project_dir TEXT,
  project_path TEXT,
  project_name TEXT,
  mtime_ms REAL,
  size_bytes INTEGER,
  indexed_at INTEGER
);
CREATE TABLE IF NOT EXISTS blocks_src (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  project_path TEXT,
  project_name TEXT,
  role TEXT,
  block_type TEXT,
  timestamp TEXT,
  seq INTEGER,
  content TEXT
);
CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks_src(session_id);
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  content,
  content='blocks_src',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks_src BEGIN
  INSERT INTO blocks_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks_src BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS blocks_au AFTER UPDATE ON blocks_src BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO blocks_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

const DROP_SQL = `
DROP TRIGGER IF EXISTS blocks_ai;
DROP TRIGGER IF EXISTS blocks_ad;
DROP TRIGGER IF EXISTS blocks_au;
DROP TABLE IF EXISTS blocks_fts;
DROP TABLE IF EXISTS blocks_src;
DROP TABLE IF EXISTS indexed_files;
DROP TABLE IF EXISTS meta;
`

export interface SqliteProviderOptions {
  /** Override the index file location (used by tests). */
  dbPath?: string
  /** Override the rescan throttle window (used by tests). */
  throttleMs?: number
}

/**
 * Convert arbitrary user input into a safe FTS5 MATCH expression.
 *
 * Every bare token is wrapped in a double-quoted string (embedded quotes
 * doubled per FTS5 escaping) and given a trailing `*` for prefix matching;
 * quoted phrases are passed through as phrases. Quoting neutralizes FTS5
 * operators and metacharacters, so the result can never throw a syntax error.
 * Returns '' when there is nothing searchable.
 */
export function sanitizeFtsQuery(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const hasWordChar = (s: string) => /[\p{L}\p{N}]/u.test(s)
  const terms: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(trimmed)) !== null && terms.length < MAX_QUERY_TERMS) {
    if (m[1] !== undefined) {
      // Quoted phrase — pass through as an FTS5 phrase.
      const phrase = m[1]
      if (!hasWordChar(phrase)) continue
      terms.push(`"${phrase.replace(/"/g, '""')}"`)
    } else if (m[2]) {
      const token = m[2]
      if (!hasWordChar(token)) continue
      terms.push(`"${token.replace(/"/g, '""')}"*`)
    }
  }

  return terms.join(' AND ')
}

interface FileRow {
  session_id: string
  mtime_ms: number
}

interface MatchRow {
  sid: string
  pp: string
  pn: string
  role: string
  bt: string
  ts: string
  score: number
  snip: string
  mc: number
}

/**
 * SQLite FTS5 search provider. Maintains an external-content FTS5 index of every
 * searchable block across all sessions, refreshed incrementally by file mtime.
 *
 * Hits map back to a session via blocks_src.session_id, which is the JSONL
 * filename stem (the canonical Claude Code session id).
 */
export class SqliteSearchProvider implements SearchProvider {
  readonly name = 'sqlite'
  private readonly dbPath: string
  private readonly throttleMs: number
  private db: SqliteDriver | null = null
  private initialized = false
  private lastRefresh = 0

  private selectFilesStmt: SqliteStatement | null = null
  private deleteBlocksStmt: SqliteStatement | null = null
  private deleteFileStmt: SqliteStatement | null = null
  private insertBlockStmt: SqliteStatement | null = null
  private upsertFileStmt: SqliteStatement | null = null
  private indexFileTxn: ((sessionId: string, file: IndexFileMeta, blocks: SearchBlock[]) => void) | null = null
  private removeSessionTxn: ((sessionId: string) => void) | null = null

  constructor(opts: SqliteProviderOptions = {}) {
    this.dbPath = opts.dbPath ?? path.join(getCacheDir(), 'search-index.db')
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS
  }

  isAvailable(): boolean {
    return this.ensureDb() !== null
  }

  private ensureDb(): SqliteDriver | null {
    if (this.initialized) return this.db
    this.initialized = true
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    } catch {
      // Directory may already exist or be unwritable — loadSqliteDriver reports.
    }
    const db = loadSqliteDriver(this.dbPath)
    if (!db) {
      this.db = null
      return null
    }
    try {
      this.initSchema(db)
      this.prepareStatements(db)
      this.db = db
    } catch {
      try {
        db.close()
      } catch {
        // ignore close failure
      }
      this.db = null
    }
    return this.db
  }

  private initSchema(db: SqliteDriver): void {
    let version = 0
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
        | { value: string }
        | undefined
      if (row) version = Number(row.value)
    } catch {
      version = 0
    }
    if (version !== SCHEMA_VERSION) {
      db.exec(DROP_SQL)
    }
    db.exec(CREATE_SQL)
    db.prepare(
      "INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(String(SCHEMA_VERSION))
  }

  private prepareStatements(db: SqliteDriver): void {
    this.selectFilesStmt = db.prepare('SELECT session_id, mtime_ms FROM indexed_files')
    this.deleteBlocksStmt = db.prepare('DELETE FROM blocks_src WHERE session_id = ?')
    this.deleteFileStmt = db.prepare('DELETE FROM indexed_files WHERE session_id = ?')
    this.insertBlockStmt = db.prepare(
      `INSERT INTO blocks_src(session_id, project_path, project_name, role, block_type, timestamp, seq, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.upsertFileStmt = db.prepare(
      `INSERT INTO indexed_files(session_id, project_dir, project_path, project_name, mtime_ms, size_bytes, indexed_at)
       VALUES (@session_id, @project_dir, @project_path, @project_name, @mtime_ms, @size_bytes, @indexed_at)
       ON CONFLICT(session_id) DO UPDATE SET
         project_dir=excluded.project_dir,
         project_path=excluded.project_path,
         project_name=excluded.project_name,
         mtime_ms=excluded.mtime_ms,
         size_bytes=excluded.size_bytes,
         indexed_at=excluded.indexed_at`,
    )

    this.indexFileTxn = db.transaction(
      (sessionId: string, file: IndexFileMeta, blocks: SearchBlock[]) => {
        this.deleteBlocksStmt!.run(sessionId)
        for (const b of blocks) {
          this.insertBlockStmt!.run(
            sessionId,
            file.projectPath,
            file.projectName,
            b.role,
            b.blockType,
            b.timestamp,
            b.seq,
            b.text,
          )
        }
        this.upsertFileStmt!.run({
          session_id: sessionId,
          project_dir: file.projectDir,
          project_path: file.projectPath,
          project_name: file.projectName,
          mtime_ms: file.mtimeMs,
          size_bytes: file.sizeBytes,
          indexed_at: Date.now(),
        })
      },
    ) as typeof this.indexFileTxn

    this.removeSessionTxn = db.transaction((sessionId: string) => {
      this.deleteBlocksStmt!.run(sessionId)
      this.deleteFileStmt!.run(sessionId)
    }) as typeof this.removeSessionTxn
  }

  async refresh(opts?: { force?: boolean }): Promise<IndexStats> {
    const start = Date.now()
    const db = this.ensureDb()
    if (!db) return emptyIndexStats(Date.now() - start)

    const force = opts?.force ?? false
    if (!force && start - this.lastRefresh < this.throttleMs) {
      return emptyIndexStats(Date.now() - start)
    }
    this.lastRefresh = start

    const stats = emptyIndexStats()

    const existing = new Map<string, number>()
    for (const row of this.selectFilesStmt!.all() as FileRow[]) {
      existing.set(row.session_id, row.mtime_ms)
    }

    const projectsDir = getProjectsDir()
    const seen = new Set<string>()
    const projects = await scanProjects()

    for (const project of projects) {
      for (const file of project.sessionFiles) {
        const sessionId = extractSessionId(file)
        seen.add(sessionId)
        const filePath = path.join(projectsDir, project.dirName, file)
        const stat = await fs.promises.stat(filePath).catch(() => null)
        if (!stat) continue

        const prevMtime = existing.get(sessionId)
        if (!force && prevMtime !== undefined && prevMtime === stat.mtimeMs) {
          stats.sessionsSkipped++
          continue
        }

        const blocks: SearchBlock[] = []
        try {
          for await (const block of extractSearchBlocks(filePath)) {
            blocks.push(block)
          }
        } catch {
          continue
        }

        this.indexFileTxn!(sessionId, {
          projectDir: project.dirName,
          projectPath: project.decodedPath,
          projectName: project.projectName,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
        }, blocks)
        stats.sessionsIndexed++
        stats.blocksIndexed += blocks.length
      }
    }

    for (const sessionId of existing.keys()) {
      if (!seen.has(sessionId)) {
        this.removeSessionTxn!(sessionId)
        stats.sessionsRemoved++
      }
    }

    stats.durationMs = Date.now() - start
    return stats
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const start = Date.now()
    const limit = query.limit ?? 20
    const offset = query.offset ?? 0
    const groupBySession = query.groupBySession ?? true

    const db = this.ensureDb()
    if (!db) {
      return { hits: [], total: 0, tookMs: Date.now() - start, provider: this.name, degraded: true }
    }

    const match = sanitizeFtsQuery(query.query)
    if (!match) {
      return { hits: [], total: 0, tookMs: Date.now() - start, provider: this.name }
    }

    const filters: string[] = []
    const filterParams: unknown[] = []
    if (query.projectPath) {
      filters.push('s.project_path = ?')
      filterParams.push(query.projectPath)
    }
    if (query.blockTypes && query.blockTypes.length > 0) {
      filters.push(`s.block_type IN (${query.blockTypes.map(() => '?').join(',')})`)
      filterParams.push(...query.blockTypes)
    }
    const whereExtra = filters.length ? ' AND ' + filters.join(' AND ') : ''

    const inner = `
      SELECT s.session_id sid, s.project_path pp, s.project_name pn, s.role role,
        s.block_type bt, s.timestamp ts, s.seq seq,
        bm25(blocks_fts) score, snippet(blocks_fts, 0, '', '', '…', ${SNIPPET_TOKENS}) snip
      FROM blocks_fts JOIN blocks_src s ON s.id = blocks_fts.rowid
      WHERE blocks_fts MATCH ?${whereExtra}`

    let rows: MatchRow[]
    let total: number

    if (groupBySession) {
      const sql = `
        SELECT sid, pp, pn, role, bt, ts, score, snip, mc FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY score ASC, seq ASC) rn,
            COUNT(*) OVER (PARTITION BY sid) mc
          FROM (${inner})
        )
        WHERE rn = 1
        ORDER BY score ASC
        LIMIT ? OFFSET ?`
      rows = db.prepare(sql).all(match, ...filterParams, limit, offset) as MatchRow[]
      const totalRow = db
        .prepare(
          `SELECT COUNT(DISTINCT s.session_id) c
           FROM blocks_fts JOIN blocks_src s ON s.id = blocks_fts.rowid
           WHERE blocks_fts MATCH ?${whereExtra}`,
        )
        .get(match, ...filterParams) as { c: number }
      total = totalRow?.c ?? 0
    } else {
      const sql = `
        SELECT sid, pp, pn, role, bt, ts, score, snip, 1 mc
        FROM (${inner})
        ORDER BY score ASC
        LIMIT ? OFFSET ?`
      rows = db.prepare(sql).all(match, ...filterParams, limit, offset) as MatchRow[]
      const totalRow = db
        .prepare(
          `SELECT COUNT(*) c
           FROM blocks_fts JOIN blocks_src s ON s.id = blocks_fts.rowid
           WHERE blocks_fts MATCH ?${whereExtra}`,
        )
        .get(match, ...filterParams) as { c: number }
      total = totalRow?.c ?? 0
    }

    const hits: SearchHit[] = rows.map((r) => ({
      sessionId: r.sid,
      projectPath: r.pp,
      projectName: r.pn,
      snippet: r.snip,
      timestamp: r.ts,
      score: r.score,
      role: r.role,
      blockType: r.bt as BlockType,
      matchCount: r.mc,
    }))

    return { hits, total, tookMs: Date.now() - start, provider: this.name }
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close()
      } catch {
        // ignore close failure
      }
    }
    this.db = null
    this.initialized = false
  }
}

interface IndexFileMeta {
  projectDir: string
  projectPath: string
  projectName: string
  mtimeMs: number
  sizeBytes: number
}
