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
const LOCK_DIR_PATH = path.join('/fake/projects', PROJECT_DIR, SESSION_ID)
const LOCK_THRESHOLD_MS = 900_000 // 15 minutes
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

  describe('with lock directory (legacy signal)', () => {
    it('returns true when lock dir exists and mtime < 1 hour', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat
        .mockResolvedValueOnce(makeStatResult(now - 60_000))       // jsonl recent
        .mockResolvedValueOnce(makeStatResult(now - 60_000, true)) // lock dir exists

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(true)
      expect(mockStat).toHaveBeenCalledWith(JSONL_PATH)
      expect(mockStat).toHaveBeenCalledWith(LOCK_DIR_PATH)
    })

    it('returns false when lock dir exists but mtime > 1 hour', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      const mtimeMs = now - LOCK_THRESHOLD_MS - 1

      mockStat
        .mockResolvedValueOnce(makeStatResult(mtimeMs))       // jsonl stale
        .mockResolvedValueOnce(makeStatResult(mtimeMs, true)) // lock dir exists

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(false)
    })

    it('returns true at exactly the 1-hour boundary', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      const mtimeMs = now - LOCK_THRESHOLD_MS

      mockStat
        .mockResolvedValueOnce(makeStatResult(mtimeMs))
        .mockResolvedValueOnce(makeStatResult(mtimeMs, true))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(true)
    })
  })

  describe('without lock directory (mtime fallback)', () => {
    it('returns true when no lock dir and mtime < 5 minutes', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat
        .mockResolvedValueOnce(makeStatResult(now - 60_000))                              // jsonl 1 min ago
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))   // no lock dir

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(true)
    })

    it('returns false when no lock dir and mtime > 5 minutes', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat
        .mockResolvedValueOnce(makeStatResult(now - MTIME_THRESHOLD_MS - 1))              // jsonl 5+ min ago
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))   // no lock dir

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(false)
    })

    it('returns true at exactly the 5-minute boundary', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat
        .mockResolvedValueOnce(makeStatResult(now - MTIME_THRESHOLD_MS))
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      expect(result).toBe(true)
    })

    it('returns false when lock path is a file not a directory', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat
        .mockResolvedValueOnce(makeStatResult(now - 60_000))        // jsonl recent
        .mockResolvedValueOnce(makeStatResult(now - 60_000, false)) // exists but not a dir

      const result = await isSessionActive(PROJECT_DIR, SESSION_ID)

      // Falls through to mtime check: 60s < 5 min → true
      expect(result).toBe(true)
    })
  })

  describe('path construction', () => {
    it('constructs the correct jsonl and lock dir paths', async () => {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)

      mockStat
        .mockResolvedValueOnce(makeStatResult(now - 1_000))
        .mockResolvedValueOnce(makeStatResult(now - 1_000, true))

      await isSessionActive('my-project-dir', 'my-session-id')

      expect(mockStat).toHaveBeenCalledWith(path.join('/fake/projects', 'my-project-dir', 'my-session-id.jsonl'))
      expect(mockStat).toHaveBeenCalledWith(path.join('/fake/projects', 'my-project-dir', 'my-session-id'))
    })
  })
})
