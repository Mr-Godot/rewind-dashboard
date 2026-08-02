import type { LiveSessionsResult } from './live-sessions'

// Legacy fallback window, used ONLY when ~/.claude/sessions is unreadable.
// NOTE (#29): <projectsDir>/<projectDir>/<sessionId> is the persistent
// subagents/tool-results directory — created the first time a session uses
// subagents and kept forever. It is NOT a liveness signal and is never stat'd.
const LEGACY_MTIME_THRESHOLD_MS = 120_000

// A record left at status:'busy' by a terminal that was closed mid-turn never
// changes on disk. statusUpdatedAt was measured 16 minutes stale on a genuinely
// busy pid, so the demotion window has to be generous.
const BUSY_MTIME_WINDOW_MS = 30 * 60_000

export type SessionLiveState = 'working' | 'waiting' | 'inactive'

/**
 * Resolve a session's liveness from Claude Code's process registry.
 *
 * Pure: the JSONL mtime is PASSED IN (the scanner already stat'd the file) and
 * can only DEMOTE a busy record, never promote a session the registry does not
 * know about. A fresh mtime alone is not liveness — `claude --resume` on a
 * months-old session touches the file without making it active.
 */
export function getSessionLiveState(
  sessionId: string,
  live: LiveSessionsResult,
  jsonlMtimeMs: number,
): SessionLiveState {
  if (!live.available) {
    return Date.now() - jsonlMtimeMs <= LEGACY_MTIME_THRESHOLD_MS ? 'working' : 'inactive'
  }

  const record = live.sessions.get(sessionId)
  if (!record) return 'inactive'

  if (record.status === 'busy' && Date.now() - jsonlMtimeMs <= BUSY_MTIME_WINDOW_MS) {
    return 'working'
  }

  return 'waiting'
}
