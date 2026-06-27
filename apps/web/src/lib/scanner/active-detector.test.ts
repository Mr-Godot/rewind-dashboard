import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', () => ({
  promises: {
    stat: vi.fn(),
  },
}))

vi.mock('@/lib/utils/claude-path', () => ({
  getProjectsDir: vi.fn(() => '/fake/projects'),
}))

import * as fs from 'node:fs'
import * as path from 'node:path'
import { isSessionActive } from './active-detector'

const mockStat = fs.promises.stat as ReturnType<typeof vi.fn>

const PROJECT_DIR = 'some-project'
const SESSION_ID = 'session-abc-123'
const JSONL_PATH = path.join('/fake/projects', PROJECT_DIR, `${SESSION_ID}.jsonl`)
// The subagents/tool-results dir — must NOT influence liveness (#29).
const SUBAGENT_DIR_PATH = path.join('/fake/projects', PROJECT_DIR, SESSION_ID)
const MTIME_THRESHOLD_MS = 120_000  // 2 minutes

function makeStatResult(mtimeMs: number, isDir = false) {
  return {
    mtimeMs,
    isDirectory: () => isDir,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('isSessionActive', () => {
  describe('jsonl file not found', () => {
    it('returns false when jsonl stat throws ENOENT', async () => {
      vi.setSystemTime(1_700_000_000_000)

      mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(false)
      expect(mockStat).toHaveBeenCalledTimes(1)
      expect(mockStat).toHaveBeenCalledWith(JSONL_PATH)
    })

    it('returns false when jsonl stat throws permission error', async () => {
      vi.setSystemTime(1_700_000_000_000)

      mockStat.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(false)
    })
  })

  describe('mtime-based liveness (single threshold)', () => {
    it('returns true when jsonl mtime < 2 minutes', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat.mockResolvedValueOnce(makeStatResult(now - 60_000))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(true)
    })

    it('returns false when jsonl mtime > 2 minutes', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat.mockResolvedValueOnce(makeStatResult(now - MTIME_THRESHOLD_MS - 1))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(false)
    })

    it('returns true at exactly the 2-minute boundary', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat.mockResolvedValueOnce(makeStatResult(now - MTIME_THRESHOLD_MS))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(true)
    })

    it('decides liveness from the jsonl file alone (single stat call)', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat.mockResolvedValueOnce(makeStatResult(now - 60_000))

      await isSessionActive(PROJECT_DIR, SESSION_ID)

      // Only the jsonl is stat'd — the subagent dir is never consulted.
      expect(mockStat).toHaveBeenCalledTimes(1)
      expect(mockStat).toHaveBeenCalledWith(JSONL_PATH)
      expect(mockStat).not.toHaveBeenCalledWith(SUBAGENT_DIR_PATH)
    })
  })

  describe('subagent dir is not a liveness signal (#29)', () => {
    it('returns false for a stale session even when a subagent dir exists on disk', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      // jsonl is 10 min old: well past the 2-min window. A subagents dir may
      // exist (this session used subagents) but must NOT extend liveness.
      mockStat.mockResolvedValueOnce(makeStatResult(now - 600_000))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(false)
      // No second stat for the subagent dir — it is irrelevant to liveness.
      expect(mockStat).toHaveBeenCalledTimes(1)
      expect(mockStat).not.toHaveBeenCalledWith(SUBAGENT_DIR_PATH)
    })
  })

  describe('path construction', () => {
    it('constructs the correct jsonl path', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat.mockResolvedValueOnce(makeStatResult(now - 1_000))

      await isSessionActive('my-project-dir', 'my-session-id')

      expect(mockStat).toHaveBeenCalledWith(path.join('/fake/projects', 'my-project-dir', 'my-session-id.jsonl'))
    })
  })
})
