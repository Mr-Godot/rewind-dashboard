import { describe, it, expect } from 'vitest'
import { countWorkingSessions, hasWorkingSession, mergeLiveStates } from './active-merge'
import type { LiveSessionState, SessionSummary } from '@/lib/parsers/types'

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'session-1',
    projectDir: '-path-to-project',
    projectPath: '/path/to/project',
    projectName: 'test-project',
    branch: 'main',
    cwd: '/path/to/project',
    startedAt: '2026-01-01T10:00:00Z',
    lastActiveAt: '2026-01-01T11:00:00Z',
    durationMs: 3600000,
    messageCount: 10,
    userMessageCount: 5,
    assistantMessageCount: 5,
    isActive: false,
    sessionState: 'inactive' as const,
    model: 'claude-opus-4-6',
    version: '1.0.0',
    fileSizeBytes: 1024,
    totalTokens: 0,
    firstUserMessage: null,
    claudeName: null,
    ...overrides,
  }
}

const working: LiveSessionState = { sessionId: 'session-1', sessionState: 'working' }
const waiting: LiveSessionState = { sessionId: 'session-1', sessionState: 'waiting' }

describe('hasWorkingSession', () => {
  it('is false when only waiting sessions are live', () => {
    // Gates the paginated poll: waiting-only must keep the 30s interval and
    // never degrade to a 5s full scan.
    expect(hasWorkingSession([waiting, { sessionId: 's2', sessionState: 'waiting' }])).toBe(false)
  })

  it('is true as soon as one session is working', () => {
    expect(hasWorkingSession([waiting, { sessionId: 's2', sessionState: 'working' }])).toBe(true)
  })

  it('is false for an empty payload', () => {
    expect(hasWorkingSession([])).toBe(false)
  })
})

describe('countWorkingSessions', () => {
  it('counts only working sessions', () => {
    expect(
      countWorkingSessions([
        working,
        { sessionId: 's2', sessionState: 'waiting' },
        { sessionId: 's3', sessionState: 'working' },
      ]),
    ).toBe(2)
  })

  it('is 0 when everything is waiting', () => {
    expect(countWorkingSessions([waiting])).toBe(0)
  })
})

describe('mergeLiveStates', () => {
  it('promotes a session present in the payload as working', () => {
    const merged = mergeLiveStates([makeSession()], [working], true)

    expect(merged[0].sessionState).toBe('working')
    expect(merged[0].isActive).toBe(true)
  })

  it('marks a waiting session as NOT active', () => {
    const merged = mergeLiveStates([makeSession()], [waiting], true)

    expect(merged[0].sessionState).toBe('waiting')
    expect(merged[0].isActive).toBe(false)
  })

  it('downgrades a working session that vanishes from the next payload', () => {
    const first = mergeLiveStates([makeSession()], [working], true)
    expect(first[0].isActive).toBe(true)

    // One poll later the process is gone. The old merge (`if (!active) return s`)
    // left the row pinned as working forever.
    const second = mergeLiveStates(first, [], true)

    expect(second[0].sessionState).toBe('inactive')
    expect(second[0].isActive).toBe(false)
  })

  it('leaves the scan result untouched while the poll is pending or errored', () => {
    const scanned = [makeSession({ sessionState: 'working', isActive: true })]

    const merged = mergeLiveStates(scanned, [], false)

    expect(merged).toBe(scanned)
    expect(merged[0].sessionState).toBe('working')
    expect(merged[0].isActive).toBe(true)
  })

  it('does not mutate the input sessions', () => {
    const scanned = [makeSession()]

    mergeLiveStates(scanned, [working], true)

    expect(scanned[0].isActive).toBe(false)
    expect(scanned[0].sessionState).toBe('inactive')
  })

  it('only touches the sessions named in the payload', () => {
    const sessions = [makeSession(), makeSession({ sessionId: 'session-2' })]

    const merged = mergeLiveStates(sessions, [working], true)

    expect(merged.map((s) => s.sessionState)).toEqual(['working', 'inactive'])
  })
})
