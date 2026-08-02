import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSessionLiveState } from './active-detector'
import type { LiveSession, LiveSessionsResult } from './live-sessions'

const NOW = 1_700_000_000_000
const SESSION_ID = 'session-abc-123'
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

function makeRecord(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    sessionId: SESSION_ID,
    pid: 4242,
    status: 'idle',
    updatedAt: NOW,
    ...overrides,
  }
}

function live(records: LiveSession[] = [], available = true): LiveSessionsResult {
  return { available, sessions: new Map(records.map((r) => [r.sessionId, r])) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getSessionLiveState', () => {
  describe('registry available', () => {
    it('REGRESSION: a fresh mtime does NOT make a session absent from the registry active', () => {
      // The user's bug: `claude --resume` (or any write) touches a months-old
      // JSONL and the old mtime heuristic reported "working" forever.
      expect(getSessionLiveState(SESSION_ID, live([]), NOW)).toBe('inactive')
    })

    it('returns inactive for a session absent from the registry even when other sessions are live', () => {
      const registry = live([makeRecord({ sessionId: 'other', status: 'busy' })])

      expect(getSessionLiveState(SESSION_ID, registry, NOW)).toBe('inactive')
    })

    it('returns waiting for a live pid with status idle and a 6-month-old mtime', () => {
      const registry = live([makeRecord({ status: 'idle' })])

      expect(getSessionLiveState(SESSION_ID, registry, NOW - SIX_MONTHS_MS)).toBe('waiting')
    })

    it('returns waiting for a live pid with status idle and a brand new mtime', () => {
      const registry = live([makeRecord({ status: 'idle' })])

      // mtime can only DEMOTE a busy record — it never promotes an idle one.
      expect(getSessionLiveState(SESSION_ID, registry, NOW)).toBe('waiting')
    })

    it('returns working for a live pid with status busy and a 1-minute-old mtime', () => {
      const registry = live([makeRecord({ status: 'busy' })])

      expect(getSessionLiveState(SESSION_ID, registry, NOW - 60_000)).toBe('working')
    })

    it('returns waiting for status busy with a 6-month-old mtime (killed-while-busy hole)', () => {
      const registry = live([makeRecord({ status: 'busy' })])

      expect(getSessionLiveState(SESSION_ID, registry, NOW - SIX_MONTHS_MS)).toBe('waiting')
    })

    it('demotes a busy record exactly past the 30-minute window', () => {
      const registry = live([makeRecord({ status: 'busy' })])

      expect(getSessionLiveState(SESSION_ID, registry, NOW - 30 * 60_000)).toBe('working')
      expect(getSessionLiveState(SESSION_ID, registry, NOW - 30 * 60_000 - 1)).toBe('waiting')
    })

    it('treats an unknown status as waiting, never working', () => {
      const registry = live([makeRecord({ status: 'unknown' })])

      expect(getSessionLiveState(SESSION_ID, registry, NOW)).toBe('waiting')
    })
  })

  describe('registry unavailable (legacy mtime fallback)', () => {
    const unavailable = live([], false)

    it('returns working when the jsonl was written under 2 minutes ago', () => {
      expect(getSessionLiveState(SESSION_ID, unavailable, NOW - 60_000)).toBe('working')
    })

    it('returns working exactly at the 2-minute boundary', () => {
      expect(getSessionLiveState(SESSION_ID, unavailable, NOW - 120_000)).toBe('working')
    })

    it('returns inactive past the 2-minute boundary', () => {
      expect(getSessionLiveState(SESSION_ID, unavailable, NOW - 120_001)).toBe('inactive')
    })

    it('never returns waiting when the registry is unavailable', () => {
      const states = [NOW, NOW - 60_000, NOW - 600_000, NOW - SIX_MONTHS_MS].map((m) =>
        getSessionLiveState(SESSION_ID, unavailable, m),
      )

      expect(states).toEqual(['working', 'working', 'inactive', 'inactive'])
    })

    it('ignores any records that happen to be in the map when available is false', () => {
      const stale = { available: false, sessions: new Map([[SESSION_ID, makeRecord({ status: 'busy' })]]) }

      expect(getSessionLiveState(SESSION_ID, stale, NOW - 600_000)).toBe('inactive')
    })
  })

  describe('purity (#29: the subagent dir is never a liveness signal)', () => {
    it('touches no filesystem API — the mtime is passed in, never re-stat-ed', async () => {
      // active-detector no longer imports node:fs at all. If it did, this spy
      // would be the only way it could reach the disk.
      const fs = await import('node:fs')
      const statSpy = vi.spyOn(fs.promises, 'stat')

      getSessionLiveState(SESSION_ID, live([makeRecord({ status: 'busy' })]), NOW)
      getSessionLiveState(SESSION_ID, live([], false), NOW)

      expect(statSpy).not.toHaveBeenCalled()
      statSpy.mockRestore()
    })
  })
})
