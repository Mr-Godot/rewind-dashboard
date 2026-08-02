import * as fs from 'node:fs'
import * as path from 'node:path'
import { getClaudeDir } from '../utils/claude-path'

/** One record from ~/.claude/sessions/<pid>.json, filtered to a live process. */
export interface LiveSession {
  sessionId: string
  pid: number
  status: string
  name?: string
  nameSource?: string
  cwd?: string
  startedAt?: number
  updatedAt: number
}

export interface LiveSessionsResult {
  /**
   * TRUE iff the sessions directory could be read, INDEPENDENT of how many
   * records survived filtering. An empty map with available:true is the normal
   * "no session open" case and must NOT trigger an mtime fallback.
   */
  available: boolean
  sessions: Map<string, LiveSession>
}

export type IsPidAlive = (pid: number) => boolean

/**
 * Signal 0 sends nothing — it only probes for the process's existence.
 * EPERM means the pid exists but belongs to another user, i.e. still alive.
 */
export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const MEMO_TTL_MS = 1000

let memo: { at: number; result: LiveSessionsResult } | null = null
let warnedUnavailable = false

/** Test seam: drop the memoized read and the once-per-process warning latch. */
export function resetLiveSessionsCache(): void {
  memo = null
  warnedUnavailable = false
}

/**
 * Read Claude Code's live process registry (~/.claude/sessions/*.json).
 * Read-only: no writes, no spawns — liveness is probed with process.kill(pid, 0).
 */
export function readLiveSessions(isPidAlive: IsPidAlive = defaultIsPidAlive): LiveSessionsResult {
  // Only the production probe shares the memo: an injected probe must never
  // read, or leave behind, a result produced by a different probe.
  const memoizable = isPidAlive === defaultIsPidAlive
  const now = Date.now()
  if (memoizable && memo && now - memo.at < MEMO_TTL_MS) return memo.result

  const sessions = new Map<string, LiveSession>()
  const sessionsDir = path.join(getClaudeDir(), 'sessions')

  let files: string[]
  try {
    files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'))
  } catch {
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn('[live-sessions] ~/.claude/sessions unavailable, falling back to mtime heuristic')
    }
    const result: LiveSessionsResult = { available: false, sessions }
    if (memoizable) memo = { at: now, result }
    return result
  }

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf-8')
      const data = JSON.parse(raw)
      if (typeof data?.sessionId !== 'string' || !data.sessionId) continue
      if (typeof data.pid !== 'number') continue
      if (!isPidAlive(data.pid)) continue

      const record: LiveSession = {
        sessionId: data.sessionId,
        pid: data.pid,
        status: typeof data.status === 'string' ? data.status : 'unknown',
        name: typeof data.name === 'string' ? data.name : undefined,
        nameSource: typeof data.nameSource === 'string' ? data.nameSource : undefined,
        cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
        startedAt: typeof data.startedAt === 'number' ? data.startedAt : undefined,
        updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      }

      const existing = sessions.get(record.sessionId)
      if (existing && existing.updatedAt >= record.updatedAt) continue
      sessions.set(record.sessionId, record)
    } catch {
      // Malformed or unreadable file — skip it, never abort the read.
    }
  }

  const result: LiveSessionsResult = { available: true, sessions }
  if (memoizable) memo = { at: now, result }
  return result
}
