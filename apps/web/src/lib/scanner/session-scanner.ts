import * as fs from 'node:fs'
import * as path from 'node:path'
import { getProjectsDir, extractSessionId } from '../utils/claude-path'
import { resolveProjectNames } from '../utils/project-identity'
import { scanProjects } from './project-scanner'
import { getSessionLiveState } from './active-detector'
import { readLiveSessions } from './live-sessions'
import type { LiveSession } from './live-sessions'
import { parseSummary } from '../parsers/session-parser'
import { getCacheDir } from '../cache/disk-cache'
import type { LiveSessionState, SessionSummary } from '../parsers/types'

/** Extended summary that includes the absolute JSONL file path (server-side only). */
export interface SessionSummaryWithPath extends SessionSummary {
  filePath: string
  /** mtime of the JSONL file at scan time. Server-only: never serialized to the client. */
  mtimeMs: number
}

// In-memory cache: sessionId -> { mtime, summary }
// Cache version: bump to invalidate after code changes (e.g. new fields)
// In-memory mtime cache. Cleared on HMR module reload (new Map instance).
const summaryCache = new Map<
  string,
  { mtimeMs: number; summary: SessionSummary }
>()

// Disk persistence for summaryCache. The in-memory Map is cleared on every
// server start / HMR reload, which forces a full re-parse of every session on
// first load ("loads forever"). Persisting it to disk lets cold starts reuse
// prior parse results — entries are still mtime-guarded in the scan loop, so
// parsing/naming/sort behavior is unchanged. Bump version to invalidate.
const SUMMARY_CACHE_VERSION = 5
let summaryCacheHydrated = false

function summaryCachePath(): string {
  return path.join(getCacheDir(), 'session-summaries.json')
}

/**
 * Returns true when the in-memory cache reflects a valid on-disk cache file.
 * A false return means the on-disk file is missing, corrupt or version-mismatched,
 * so the caller must rewrite it instead of re-parsing forever.
 */
function hydrateSummaryCache(): boolean {
  if (summaryCacheHydrated) return true
  summaryCacheHydrated = true
  try {
    const raw = fs.readFileSync(summaryCachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as {
      version?: number
      entries?: Record<string, { mtimeMs: number; summary: SessionSummary }>
    }
    if (parsed.version !== SUMMARY_CACHE_VERSION || !parsed.entries) return false
    for (const [sessionId, entry] of Object.entries(parsed.entries)) {
      if (entry && typeof entry.mtimeMs === 'number' && entry.summary) {
        summaryCache.set(sessionId, { mtimeMs: entry.mtimeMs, summary: entry.summary })
      }
    }
    return true
  } catch {
    // No cache yet, or it is corrupt/outdated — start cold. Never fatal.
    return false
  }
}

function persistSummaryCache(): void {
  try {
    const dir = getCacheDir()
    fs.mkdirSync(dir, { recursive: true })
    const entries: Record<string, { mtimeMs: number; summary: SessionSummary }> = {}
    for (const [sessionId, entry] of summaryCache) entries[sessionId] = entry
    const cachePath = summaryCachePath()
    const tmpPath = `${cachePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify({ version: SUMMARY_CACHE_VERSION, entries }), 'utf-8')
    fs.renameSync(tmpPath, cachePath)
  } catch {
    // Cache write failure must never break scanning.
  }
}

// sessionId -> absolute JSONL path, learned from the last scan. Lets the 3s
// liveness poll stat only the handful of registry entries instead of rescanning
// every project directory.
const sessionFilePaths = new Map<string, string>()

// In-flight scan promise. Three pollers (active 3s, list 30s, paginated 5/30s)
// can request a scan concurrently; with a cold in-memory cache that fired
// overlapping full scans. Concurrent callers now await the SAME promise.
let inFlightScan: Promise<SessionSummaryWithPath[]> | null = null

/**
 * Internal scanning entry point. Coalesces concurrent calls onto one scan so
 * a cold cache never triggers overlapping full scans. Used by both public APIs.
 */
async function scanSessionsInternal(): Promise<SessionSummaryWithPath[]> {
  if (inFlightScan) return inFlightScan
  inFlightScan = runScan()
  try {
    return await inFlightScan
  } finally {
    inFlightScan = null
  }
}

/**
 * Clear the summary cache: empties the in-memory Map, resets the hydration
 * flag, and best-effort deletes the on-disk session-summaries.json. The unlink
 * is scoped strictly to summaryCachePath() — metadata/settings are never touched.
 */
export function clearSummaryCache(): void {
  summaryCache.clear()
  summaryCacheHydrated = false
  try {
    fs.unlinkSync(summaryCachePath())
  } catch {
    // No cache file, or unlink failed — never fatal.
  }
}

/**
 * The actual scanning logic that returns summaries with their file paths.
 */
async function runScan(): Promise<SessionSummaryWithPath[]> {
  // A failed hydrate leaves the on-disk file corrupt/outdated: force a rewrite.
  let dirty = !hydrateSummaryCache()
  const projects = await scanProjects()
  // One registry read per scan, shared by every session below (memoized ~1s).
  const live = readLiveSessions()
  const summaries: SessionSummaryWithPath[] = []
  // Same objects as `summaries`, bucketed by dir for the identity pass below.
  const byProjectDir = new Map<string, SessionSummaryWithPath[]>()

  for (const project of projects) {
    const bucket: SessionSummaryWithPath[] = []
    byProjectDir.set(project.dirName, bucket)
    for (const file of project.sessionFiles) {
      const sessionId = extractSessionId(file)
      const filePath = path.join(
        getProjectsDir(),
        project.dirName,
        file,
      )

      const stat = await fs.promises.stat(filePath).catch(() => null)
      if (!stat) continue
      sessionFilePaths.set(sessionId, filePath)

      // Check cache
      const cached = summaryCache.get(sessionId)
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        // Refresh active status even for cached entries. The only name source is
        // the durable JSONL custom-title already captured in the cached summary.
        const claudeName = cached.summary.claudeName ?? null
        const sessionState = getSessionLiveState(sessionId, live, stat.mtimeMs)
        const isActive = sessionState === 'working'
        const entry = { ...cached.summary, projectDir: project.dirName, isActive, sessionState, claudeName, filePath, mtimeMs: stat.mtimeMs }
        summaries.push(entry)
        bucket.push(entry)
        continue
      }

      // Parse summary in a single full streaming pass
      const summary = await parseSummary(
        filePath,
        sessionId,
        project.decodedPath,
        project.projectName,
        stat.size,
        stat.mtimeMs,
      )

      if (summary) {
        const sessionState = getSessionLiveState(sessionId, live, stat.mtimeMs)
        summary.projectDir = project.dirName
        summary.isActive = sessionState === 'working'
        summary.sessionState = sessionState

        summaryCache.set(sessionId, {
          mtimeMs: stat.mtimeMs,
          summary,
        })
        dirty = true
        const entry = { ...summary, filePath, mtimeMs: stat.mtimeMs }
        summaries.push(entry)
        bucket.push(entry)
      }
    }
  }

  // Project identity from the recorded cwd. Runs on cached entries too, or the
  // ~450 sessions whose mtime never changes would keep their wrong names forever.
  applyProjectIdentity(byProjectDir)

  // Sort by last active, newest first
  summaries.sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )

  // Prune cache entries for sessions that no longer exist (also caps the
  // in-memory Map), then persist so the next cold start is fast.
  const seen = new Set(summaries.map((s) => s.sessionId))
  for (const key of sessionFilePaths.keys()) {
    if (!seen.has(key)) sessionFilePaths.delete(key)
  }
  for (const key of summaryCache.keys()) {
    if (!seen.has(key)) {
      summaryCache.delete(key)
      dirty = true
    }
  }
  if (dirty) persistSummaryCache()

  // Exclude content-less stub files (summary / file-history-snapshot only, i.e.
  // zero conversation messages) unless currently active. Real sessions always
  // have at least one message; this keeps metadata stubs out of the list without
  // ever dropping a genuine or in-progress session.
  return summaries.filter((s) => s.messageCount > 0 || s.isActive)
}

/**
 * The cwd recorded by the most recently active session of a project dir. The
 * whole file was already parsed, so this costs zero extra I/O and is immune to
 * a head-read heuristic missing a dir whose first records carry no cwd.
 */
function newestRecordedCwd(entries: SessionSummaryWithPath[]): string | null {
  let best: SessionSummaryWithPath | null = null
  for (const entry of entries) {
    if (!entry.cwd) continue
    if (!best || entry.lastActiveAt > best.lastActiveAt) best = entry
  }
  return best?.cwd ?? null
}

/**
 * Stamp realPath / pathExists / projectName onto every session of every dir.
 * A dir whose recorded cwd is gone is FLAGGED, never hidden: most of the real
 * history lives in dirs whose project has since moved.
 */
function applyProjectIdentity(byProjectDir: Map<string, SessionSummaryWithPath[]>): void {
  const inputs = Array.from(byProjectDir)
    .filter(([, entries]) => entries.length > 0)
    .map(([key, entries]) => ({
      key,
      realPath: newestRecordedCwd(entries),
      fallbackName: entries[0].projectName,
    }))
  const names = resolveProjectNames(inputs)

  const existsCache = new Map<string, boolean>()
  for (const input of inputs) {
    const entries = byProjectDir.get(input.key) ?? []
    let pathExists = true
    if (input.realPath !== null) {
      const cached = existsCache.get(input.realPath)
      pathExists = cached ?? fs.existsSync(input.realPath)
      existsCache.set(input.realPath, pathExists)
    }
    const projectName = names.get(input.key) as string
    for (const entry of entries) {
      entry.realPath = input.realPath
      entry.pathExists = pathExists
      entry.projectName = projectName
    }
  }
}

/** Public API: returns SessionSummary[] without filePath -- used by server functions that serialize to client. */
export async function scanAllSessions(): Promise<SessionSummary[]> {
  const results = await scanSessionsInternal()
  // Strip server-only fields to avoid leaking absolute paths to the client
  return results.map(({ filePath: _filePath, mtimeMs: _mtimeMs, ...summary }) => summary)
}

/** Public API: returns SessionSummaryWithPath[] -- used by server-side stats enrichment. */
export async function scanAllSessionsWithPaths(): Promise<SessionSummaryWithPath[]> {
  return scanSessionsInternal()
}

/**
 * Claude Code encodes a cwd into a project directory name by replacing every
 * non-alphanumeric character with '-':
 * `C:\Users\a\_work\proj` -> `C--Users-a--work-proj`.
 */
function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * JSONL mtime for ONE live session. Resolves the file from the last scan, or
 * from the registry record's own cwd when the session has never been scanned.
 * Returns 0 when the file cannot be found, which demotes a busy record to
 * 'waiting' — an unverifiable busy record must never restart the timer.
 */
function liveSessionMtimeMs(record: LiveSession): number {
  const candidates = [sessionFilePaths.get(record.sessionId)]
  if (record.cwd) {
    candidates.push(
      path.join(getProjectsDir(), encodeProjectDirName(record.cwd), `${record.sessionId}.jsonl`),
    )
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return fs.statSync(candidate).mtimeMs
    } catch {
      // Missing or unreadable — try the next candidate.
    }
  }
  return 0
}

/**
 * Public API: liveness only, straight from the process registry. Deliberately
 * does NOT scan sessions — this is polled every few seconds and a full scan per
 * poll was the second-largest cost on the server.
 *
 * Resolves through the SAME getSessionLiveState() the 30s scan uses, so the
 * poll cannot flip a session the scan demoted back to 'working'. Only a 'busy'
 * record needs an mtime, so this stats at most one file per busy registry entry.
 */
export function getLiveSessionStates(): LiveSessionState[] {
  const live = readLiveSessions()
  if (!live.available) return []
  return Array.from(live.sessions.values(), (record) => {
    const state = getSessionLiveState(
      record.sessionId,
      live,
      record.status === 'busy' ? liveSessionMtimeMs(record) : 0,
    )
    // 'inactive' means "absent from the registry", which cannot happen for a
    // record taken from that same registry.
    return {
      sessionId: record.sessionId,
      sessionState: state === 'working' ? ('working' as const) : ('waiting' as const),
    }
  })
}
