import * as fs from 'node:fs'
import * as path from 'node:path'
import { getProjectsDir, extractSessionId } from '../utils/claude-path'
import { getCacheDir } from '../cache/disk-cache'
import { scanProjects } from '../scanner/project-scanner'
import { extractSearchBlocks, type SearchBlock } from './block-extractor'
import { loadSqliteDriver, type SqliteDriver, type SqliteStatement } from './sqlite-driver'
import { readTitleSource, resolveTitle, type SessionTitleRecord } from './title-source'
import { normalizeForSearch } from './name-match'
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
/** Files indexed between event-loop yields during a refresh pass. */
const YIELD_EVERY_FILES = 25

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
  /** 1 when any matching block in this session was the title row. */
  tm: number
}

/** One session's name row, queued during a refresh pass. */
interface TitleRowWrite {
  sessionId: string
  projectPath: string
  projectName: string
  timestamp: string
  content: string
}

/**
 * Searchable text for a session's name row: the Rewind rename, the Claude Code
 * `/rename` title, the project name and the folded project dir, followed by the
 * whole thing folded again. Emitting both forms costs a few dozen bytes and
 * makes `orbit-crm-v2`, `orbit crm v2` and `orbit crm` all reachable through
 * the unicode61 tokenizer.
 */
function buildTitleContent(
  record: SessionTitleRecord | undefined,
  projectName: string,
  projectDir: string,
): string {
  const parts = [record?.customName, record?.claudeName, projectName, normalizeForSearch(projectDir)]
  const raw = parts.filter((p): p is string => !!p && p.trim().length > 0).join(' ')
  if (!raw) return ''
  const folded = normalizeForSearch(raw)
  return folded && folded !== raw ? `${raw} ${folded}` : raw
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
  private inFlightRefresh: Promise<IndexStats> | null = null
  private inFlightForced = false

  private selectFilesStmt: SqliteStatement | null = null
  private deleteBlocksStmt: SqliteStatement | null = null
  private deleteFileStmt: SqliteStatement | null = null
  private insertBlockStmt: SqliteStatement | null = null
  private upsertFileStmt: SqliteStatement | null = null
  private deleteTitleStmt: SqliteStatement | null = null
  private selectTitleSessionsStmt: SqliteStatement | null = null
  private upsertMetaStmt: SqliteStatement | null = null
  private indexFileTxn: ((sessionId: string, file: IndexFileMeta, blocks: SearchBlock[]) => void) | null = null
  private removeSessionTxn: ((sessionId: string) => void) | null = null
  private writeTitlesTxn: ((rows: TitleRowWrite[]) => void) | null = null

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

    this.deleteTitleStmt = db.prepare(
      "DELETE FROM blocks_src WHERE session_id = ? AND block_type = 'title'",
    )
    this.selectTitleSessionsStmt = db.prepare(
      "SELECT session_id FROM blocks_src WHERE block_type = 'title'",
    )
    this.upsertMetaStmt = db.prepare(
      'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    )

    this.removeSessionTxn = db.transaction((sessionId: string) => {
      this.deleteBlocksStmt!.run(sessionId)
      this.deleteFileStmt!.run(sessionId)
    }) as typeof this.removeSessionTxn

    // One transaction for the whole backfill: the first pass after this ships
    // writes a name row for every session, and a transaction each would be
    // thousands of fsyncs.
    this.writeTitlesTxn = db.transaction((rows: TitleRowWrite[]) => {
      for (const row of rows) {
        // Delete first so the FTS delete trigger fires and no stale name lingers.
        this.deleteTitleStmt!.run(row.sessionId)
        this.insertBlockStmt!.run(
          row.sessionId,
          row.projectPath,
          row.projectName,
          'meta',
          'title',
          row.timestamp,
          -1,
          row.content,
        )
      }
    }) as typeof this.writeTitlesTxn
  }

  /**
   * Incrementally reindex changed session files.
   *
   * Concurrent callers share ONE pass: a cold index takes tens of seconds and
   * the write lock is synchronous, so overlapping passes serialize into a
   * multi-minute stall. The throttle is measured from the END of the previous
   * pass for the same reason: measuring from the start admits a duplicate scan
   * the moment the pass runs longer than the throttle window.
   *
   * A forced call is NEVER satisfied by an in-flight non-forced pass: that pass
   * skips unchanged files, so a rebuild request would silently no-op. It queues
   * behind the running pass instead of racing it against the write lock.
   */
  async refresh(opts?: { force?: boolean }): Promise<IndexStats> {
    const force = opts?.force ?? false
    if (this.inFlightRefresh && (!force || this.inFlightForced)) return this.inFlightRefresh

    const previous = this.inFlightRefresh
    const pass = (async () => {
      if (previous) await previous.catch(() => undefined)
      return this.runRefresh(opts)
    })()
    this.inFlightRefresh = pass
    this.inFlightForced = force
    try {
      return await pass
    } finally {
      // A newer pass may have taken over while this one ran; never clear theirs.
      if (this.inFlightRefresh === pass) {
        this.inFlightRefresh = null
        this.inFlightForced = false
      }
    }
  }

  private async runRefresh(opts?: { force?: boolean }): Promise<IndexStats> {
    const start = Date.now()
    const db = this.ensureDb()
    if (!db) return emptyIndexStats(Date.now() - start)

    const force = opts?.force ?? false
    if (!force && start - this.lastRefresh < this.throttleMs) {
      return emptyIndexStats(Date.now() - start)
    }

    const stats = emptyIndexStats()
    let processed = 0

    const existing = new Map<string, number>()
    for (const row of this.selectFilesStmt!.all() as FileRow[]) {
      existing.set(row.session_id, row.mtime_ms)
    }

    // Session names live outside the JSONL files: a Rewind rename only rewrites
    // session-metadata.json, so mtime-based skipping would never notice it.
    // titles_mtime is the separate freshness signal that makes a rename
    // searchable on the next pass, with no restart and no schema bump.
    const { titles, metadataMtimeMs } = readTitleSource()
    let titlesStale = true
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key='titles_mtime'").get() as
        | { value: string }
        | undefined
      titlesStale = String(metadataMtimeMs) !== row?.value
    } catch {
      titlesStale = true
    }
    const withTitleRow = new Set<string>()
    for (const row of this.selectTitleSessionsStmt!.all() as { session_id: string }[]) {
      withTitleRow.add(row.session_id)
    }
    const pendingTitles: TitleRowWrite[] = []

    const projectsDir = getProjectsDir()
    const seen = new Set<string>()
    const projects = await scanProjects()

    for (const project of projects) {
      for (const file of project.sessionFiles) {
        if (++processed % YIELD_EVERY_FILES === 0) {
          // Hand the single Node event loop back so a long pass does not block
          // every other request for its whole duration.
          await new Promise((r) => setImmediate(r))
        }
        const sessionId = extractSessionId(file)
        seen.add(sessionId)
        const filePath = path.join(projectsDir, project.dirName, file)
        const stat = await fs.promises.stat(filePath).catch(() => null)
        if (!stat) continue

        // Never the empty string: an empty ts sorts dead last under ORDER BY ts
        // DESC and the name row would be truncated away by any broad query.
        const queueTitle = () => {
          const content = buildTitleContent(
            titles.get(sessionId),
            project.projectName,
            project.dirName,
          )
          if (!content) return
          pendingTitles.push({
            sessionId,
            projectPath: project.decodedPath,
            projectName: project.projectName,
            timestamp: new Date(stat.mtimeMs).toISOString(),
            content,
          })
        }

        const prevMtime = existing.get(sessionId)
        if (!force && prevMtime !== undefined && prevMtime === stat.mtimeMs) {
          stats.sessionsSkipped++
          // A skipped file still needs its name row when the names changed or
          // it predates this feature.
          if (titlesStale || !withTitleRow.has(sessionId)) queueTitle()
          continue
        }

        // Reindexing wipes every block for the session, name row included.
        queueTitle()

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

    // Name rows are written last: reindexing a file deletes every block it owns,
    // this one included.
    if (pendingTitles.length > 0) this.writeTitlesTxn!(pendingTitles)
    this.upsertMetaStmt!.run('titles_mtime', String(metadataMtimeMs))

    stats.durationMs = Date.now() - start
    this.lastRefresh = Date.now()
    return stats
  }

  /**
   * ISO timestamp of the newest source file mtime present in the index, or null
   * when the index is empty. Content newer than this is NOT searchable yet.
   */
  indexedThrough(): string | null {
    try {
      const row = this.db?.prepare('SELECT MAX(mtime_ms) m FROM indexed_files').get() as
        | { m: number | null }
        | undefined
      if (!row || row.m == null) return null
      return new Date(row.m).toISOString()
    } catch {
      return null
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const start = Date.now()
    const limit = query.limit ?? 20
    const offset = query.offset ?? 0
    const groupBySession = query.groupBySession ?? true

    const db = this.ensureDb()
    if (!db) {
      return {
        hits: [],
        total: 0,
        tookMs: Date.now() - start,
        provider: this.name,
        degraded: true,
        indexedThrough: null,
      }
    }

    const match = sanitizeFtsQuery(query.query)
    if (!match) {
      return {
        hits: [],
        total: 0,
        tookMs: Date.now() - start,
        provider: this.name,
        indexedThrough: this.indexedThrough(),
      }
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
      // The representative row per session is the most RECENT match, not the
      // best-scoring one: the UI renders hit.timestamp next to hit.snippet, so
      // the sort key, the rendered date and the snippet must all come from the
      // same row. A MAX(ts) OVER (...) sort key would come from a different row
      // than the snippet and reintroduces visible date inversions.
      // LIMIT applies to sessions here, since one row survives per session.
      // `tm DESC` leads the cross-session order so a NAME match outranks every
      // body-text match: `brain` matches 155 sessions, and pure recency buried
      // the handful actually named brain past the limit. The representative row
      // prefers the title row when one matched, so hit.timestamp and
      // hit.snippet still come from the same row.
      const sql = `
        SELECT sid, pp, pn, role, bt, ts, score, snip, mc, tm FROM (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY sid ORDER BY (bt='title') DESC, ts DESC, score ASC, seq ASC) rn,
            COUNT(*) OVER (PARTITION BY sid) mc,
            MAX(bt='title') OVER (PARTITION BY sid) tm
          FROM (${inner})
        )
        WHERE rn = 1
        ORDER BY tm DESC, ts DESC, sid ASC
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
        SELECT sid, pp, pn, role, bt, ts, score, snip, 1 mc, (bt='title') tm
        FROM (${inner})
        ORDER BY ts DESC, score ASC, seq ASC
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

    // Names come from the live map, not from the index: it is O(1), always
    // current, and does not wait for a refresh pass to catch a rename.
    const { titles } = readTitleSource()

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
      title: resolveTitle(titles.get(r.sid)),
      titleMatch: r.tm === 1,
    }))

    return {
      hits,
      total,
      tookMs: Date.now() - start,
      provider: this.name,
      indexedThrough: this.indexedThrough(),
    }
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
