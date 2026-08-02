import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeDir, getProjectsDir, extractSessionId } from '../utils/claude-path'
import { scanProjects } from './project-scanner'
import { getSessionLiveState } from './active-detector'
import { readLiveSessions } from './live-sessions'
import { parseSummary } from '../parsers/session-parser'
import { getCacheDir } from '../cache/disk-cache'
import type { LiveSessionState, SessionSummary } from '../parsers/types'

/** Read Claude Code's /rename names from ~/.claude/sessions/*.json */
function readClaudeSessionNames(): Map<string, string> {
  const names = new Map<string, string>()
  const sessionsDir = path.join(getClaudeDir(), 'sessions')
  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'))
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf-8')
        const data = JSON.parse(raw)
        if (data.sessionId && data.name) {
          names.set(data.sessionId, data.name)
        }
      } catch { /* skip malformed files */ }
    }
  } catch { /* sessions dir may not exist */ }
  return names
}

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
const SUMMARY_CACHE_VERSION = 4
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
  const claudeNames = readClaudeSessionNames()
  // One registry read per scan, shared by every session below (memoized ~1s).
  const live = readLiveSessions()
  const summaries: SessionSummaryWithPath[] = []

  for (const project of projects) {
    for (const file of project.sessionFiles) {
      const sessionId = extractSessionId(file)
      const filePath = path.join(
        getProjectsDir(),
        project.dirName,
        file,
      )

      const stat = await fs.promises.stat(filePath).catch(() => null)
      if (!stat) continue

      // Check cache
      const cached = summaryCache.get(sessionId)
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        // Refresh active status even for cached entries
        // claudeName: prefer session JSON name, fall back to JSONL-parsed name from cache
        const claudeName = claudeNames.get(sessionId) ?? cached.summary.claudeName ?? null
        const sessionState = getSessionLiveState(sessionId, live, stat.mtimeMs)
        const isActive = sessionState === 'working'
        summaries.push({ ...cached.summary, projectDir: project.dirName, isActive, sessionState, claudeName, filePath, mtimeMs: stat.mtimeMs })
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
        summary.claudeName = claudeNames.get(sessionId) ?? summary.claudeName ?? null

        summaryCache.set(sessionId, {
          mtimeMs: stat.mtimeMs,
          summary,
        })
        dirty = true
        summaries.push({ ...summary, filePath, mtimeMs: stat.mtimeMs })
      }
    }
  }

  // Sort by last active, newest first
  summaries.sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  )

  // Prune cache entries for sessions that no longer exist (also caps the
  // in-memory Map), then persist so the next cold start is fast.
  const seen = new Set(summaries.map((s) => s.sessionId))
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
 * Public API: liveness only, straight from the process registry. Deliberately
 * does NOT scan sessions — this is polled every few seconds and a full scan per
 * poll was the second-largest cost on the server.
 */
export function getLiveSessionStates(): LiveSessionState[] {
  const live = readLiveSessions()
  if (!live.available) return []
  return Array.from(live.sessions.values(), (record) => ({
    sessionId: record.sessionId,
    sessionState: record.status === 'busy' ? ('working' as const) : ('waiting' as const),
  }))
}
