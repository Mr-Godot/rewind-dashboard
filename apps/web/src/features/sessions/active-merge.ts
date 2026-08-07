import type { LiveSessionState, SessionSummary } from '@/lib/parsers/types'

/** Only a 'working' session counts as active: see mergeLiveStates. */
export function hasWorkingSession(live: LiveSessionState[]): boolean {
  return live.some((s) => s.sessionState === 'working')
}

export function countWorkingSessions(live: LiveSessionState[]): number {
  return live.reduce((n, s) => (s.sessionState === 'working' ? n + 1 : n), 0)
}

/**
 * Overlay the fast liveness poll onto the paginated scan results.
 *
 * Symmetric on purpose: a session missing from the payload is downgraded to
 * 'inactive' rather than left alone, so a finished session stops rendering as
 * working within one poll. `liveLoaded` guards the pending/errored case — an
 * unresolved poll must leave the scan's own state untouched instead of
 * blanking every row.
 */
export function mergeLiveStates<T extends SessionSummary>(
  sessions: T[],
  live: LiveSessionState[],
  liveLoaded: boolean,
): T[] {
  if (!liveLoaded) return sessions
  const byId = new Map(live.map((s) => [s.sessionId, s.sessionState]))
  return sessions.map((s) => {
    const sessionState = byId.get(s.sessionId) ?? 'inactive'
    return { ...s, sessionState, isActive: sessionState === 'working' }
  })
}
