import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeDir, getProjectsDir, extractSessionId } from '../utils/claude-path'
import { scanProjects } from './project-scanner'
import { isSessionActive } from './active-detector'
import { parseSummary } from '../parsers/session-parser'
import { getCacheDir } from '../cache/disk-cache'
import type { SessionSummary } from '../parsers/types'

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

function hydrateSummaryCache(): void {
  if (summaryCacheHydrated) return
  summaryCacheHydrated = true
  try {
    const raw = fs.readFileSync(summaryCachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as {
      version?: number
      entries?: Record<string, { mtimeMs: number; summary: SessionSummary }>
    }
    if (parsed.version !== SUMMARY_CACHE_VERSION || !parsed.entries) return
    for (const [sessionId, entry] of Object.entries(parsed.entries)) {
      if (entry && typeof entry.mtimeMs === 'number' && entry.summary) {
        summaryCache.set(sessionId, { mtimeMs: entry.mtimeMs, summary: entry.summary })
      }
    }
  } catch {
    // No cache yet, or it is corrupt/outdated — start cold. Never fatal.
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

/** Determine session state from active status and file freshness.
 * If isSessionActive returned true, the session is working.
 * "waiting" is reserved for future use with process-level detection. */
function getSessionState(isActive: boolean, _mtimeMs: number): 'working' | 'waiting' | 'inactive' {
  return isActive ? 'working' : 'inactive'
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
  hydrateSummaryCache()
  const projects = await scanProjects()
  const claudeNames = readClaudeSessionNames()
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
        const active = await isSessionActive(project.dirName, sessionId)
        const claudeName = claudeNames.get(sessionId) ?? cached.summary.claudeName ?? null
        const sessionState = getSessionState(active, stat.mtimeMs)
        summaries.push({ ...cached.summary, projectDir: project.dirName, isActive: active, sessionState, claudeName, filePath })
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
        const active = await isSessionActive(project.dirName, sessionId)
        summary.projectDir = project.dirName
        summary.isActive = active
        summary.sessionState = getSessionState(active, stat.mtimeMs)
        summary.claudeName = claudeNames.get(sessionId) ?? summary.claudeName ?? null

        summaryCache.set(sessionId, {
          mtimeMs: stat.mtimeMs,
          summary,
        })
        summaries.push({ ...summary, filePath })
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
    if (!seen.has(key)) summaryCache.delete(key)
  }
  persistSummaryCache()

  // Exclude content-less stub files (summary / file-history-snapshot only, i.e.
  // zero conversation messages) unless currently active. Real sessions always
  // have at least one message; this keeps metadata stubs out of the list without
  // ever dropping a genuine or in-progress session.
  return summaries.filter((s) => s.messageCount > 0 || s.isActive)
}

/** Public API: returns SessionSummary[] without filePath -- used by server functions that serialize to client. */
export async function scanAllSessions(): Promise<SessionSummary[]> {
  const results = await scanSessionsInternal()
  // Strip filePath to avoid leaking absolute paths to the client
  return results.map(({ filePath: _filePath, ...summary }) => summary)
}

/** Public API: returns SessionSummaryWithPath[] -- used by server-side stats enrichment. */
export async function scanAllSessionsWithPaths(): Promise<SessionSummaryWithPath[]> {
  return scanSessionsInternal()
}

export async function getActiveSessions(): Promise<SessionSummary[]> {
  const all = await scanAllSessions()
  return all.filter((s) => s.isActive)
}
