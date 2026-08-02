import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import type { SessionSummary } from '../parsers/types'
import type { LiveSession, LiveSessionsResult } from './live-sessions'
import type { ProjectInfo } from './project-scanner'

// Mock all external dependencies inline (vi.mock is hoisted)
vi.mock('./project-scanner', () => ({
  scanProjects: vi.fn(),
}))

vi.mock('../utils/claude-path', () => ({
  getClaudeDir: vi.fn(() => '/mock/claude'),
  getProjectsDir: vi.fn(() => '/mock/claude/projects'),
  extractSessionId: vi.fn((filename: string) => filename.replace(/\.jsonl$/, '')),
}))

vi.mock('../parsers/session-parser', () => ({
  parseSummary: vi.fn(),
}))

vi.mock('./live-sessions', () => ({
  readLiveSessions: vi.fn(),
}))

vi.mock('../cache/disk-cache', () => ({
  getCacheDir: vi.fn(() => '/mock/dashboard-cache'),
}))

vi.mock('node:fs', () => ({
  promises: {
    stat: vi.fn(),
  },
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

const NOW = 1_700_000_000_000

// Helper to build a SessionSummary fixture
function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'session-abc',
    projectDir: '-Users-user-myproject',
    projectPath: '/Users/user/myproject',
    projectName: 'myproject',
    branch: 'main',
    cwd: '/Users/user/myproject',
    startedAt: '2026-01-01T10:00:00.000Z',
    lastActiveAt: '2026-01-01T11:00:00.000Z',
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

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    dirName: '-Users-user-myproject',
    decodedPath: '/Users/user/myproject',
    projectName: 'myproject',
    sessionFiles: ['session-abc.jsonl'],
    ...overrides,
  }
}

function makeLiveRecord(sessionId: string, status: string): LiveSession {
  return { sessionId, pid: 1234, status, updatedAt: NOW }
}

/** A registry snapshot: `{ sessionId: status }` for every live process. */
function registry(records: Record<string, string> = {}, available = true): LiveSessionsResult {
  return {
    available,
    sessions: new Map(
      Object.entries(records).map(([id, status]) => [id, makeLiveRecord(id, status)]),
    ),
  }
}

describe('session-scanner', () => {
  // We need fresh module imports on each test to reset the module-level summaryCache
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function importScanner() {
    // Re-import after resetModules to get a fresh summaryCache
    const scanner = await import('./session-scanner')
    const { scanProjects } = await import('./project-scanner')
    const { parseSummary } = await import('../parsers/session-parser')
    const { readLiveSessions } = await import('./live-sessions')
    const fs = await import('node:fs')
    const mockReadLiveSessions = readLiveSessions as ReturnType<typeof vi.fn>
    // Default: registry readable, no live process.
    mockReadLiveSessions.mockReturnValue(registry())
    return {
      scanAllSessions: scanner.scanAllSessions,
      scanAllSessionsWithPaths: scanner.scanAllSessionsWithPaths,
      getLiveSessionStates: scanner.getLiveSessionStates,
      clearSummaryCache: scanner.clearSummaryCache,
      mockScanProjects: scanProjects as ReturnType<typeof vi.fn>,
      mockParseSummary: parseSummary as ReturnType<typeof vi.fn>,
      mockReadLiveSessions,
      mockStat: fs.promises.stat as ReturnType<typeof vi.fn>,
      fs,
    }
  }

  describe('scanAllSessions', () => {
    it('returns [] when there are no projects', async () => {
      const { scanAllSessions, mockScanProjects } = await importScanner()
      mockScanProjects.mockResolvedValue([])

      const result = await scanAllSessions()

      expect(result).toEqual([])
    })

    it('returns [] when a project has no session files', async () => {
      const { scanAllSessions, mockScanProjects } = await importScanner()
      mockScanProjects.mockResolvedValue([
        makeProject({ sessionFiles: [] }),
      ])

      const result = await scanAllSessions()

      expect(result).toEqual([])
    })

    it('returns a session summary for a single project and single session', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      const result = await scanAllSessions()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        sessionId: 'session-abc',
        projectName: 'myproject',
        isActive: false,
      })
      // filePath should be stripped from public API
      expect(result[0]).not.toHaveProperty('filePath')
    })

    it('returns sessions from multiple projects sorted newest-first by lastActiveAt', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      const olderSummary = makeSummary({
        sessionId: 'session-old',
        lastActiveAt: '2026-01-01T09:00:00.000Z',
        projectName: 'projectA',
      })
      const newerSummary = makeSummary({
        sessionId: 'session-new',
        lastActiveAt: '2026-01-01T11:00:00.000Z',
        projectName: 'projectB',
      })

      mockScanProjects.mockResolvedValue([
        makeProject({
          dirName: '-Users-user-projectA',
          projectName: 'projectA',
          sessionFiles: ['session-old.jsonl'],
        }),
        makeProject({
          dirName: '-Users-user-projectB',
          projectName: 'projectB',
          sessionFiles: ['session-new.jsonl'],
        }),
      ])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary
        .mockResolvedValueOnce(olderSummary)
        .mockResolvedValueOnce(newerSummary)

      const result = await scanAllSessions()

      expect(result).toHaveLength(2)
      expect(result[0].sessionId).toBe('session-new')
      expect(result[1].sessionId).toBe('session-old')
    })

    it('returns multiple sessions from a single project sorted newest-first', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      const session1 = makeSummary({
        sessionId: 'session-1',
        lastActiveAt: '2026-01-01T08:00:00.000Z',
      })
      const session2 = makeSummary({
        sessionId: 'session-2',
        lastActiveAt: '2026-01-01T12:00:00.000Z',
      })

      mockScanProjects.mockResolvedValue([
        makeProject({
          sessionFiles: ['session-1.jsonl', 'session-2.jsonl'],
        }),
      ])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary
        .mockResolvedValueOnce(session1)
        .mockResolvedValueOnce(session2)

      const result = await scanAllSessions()

      expect(result).toHaveLength(2)
      expect(result[0].sessionId).toBe('session-2')
      expect(result[1].sessionId).toBe('session-1')
    })

    it('skips sessions where fs.stat resolves null', async () => {
      const { scanAllSessions, mockScanProjects, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue(null)

      const result = await scanAllSessions()

      expect(result).toEqual([])
    })

    it('skips sessions where fs.stat rejects', async () => {
      const { scanAllSessions, mockScanProjects, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockRejectedValue(new Error('ENOENT'))

      const result = await scanAllSessions()

      expect(result).toEqual([])
    })

    it('skips sessions where parseSummary returns null', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(null)

      const result = await scanAllSessions()

      expect(result).toEqual([])
    })

    it('excludes content-less stub sessions (0 messages, inactive)', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary({ messageCount: 0 }))

      const result = await scanAllSessions()

      expect(result).toEqual([])
    })

    it('keeps a 0-message session when it is currently working', async () => {
      const {
        scanAllSessions,
        mockScanProjects,
        mockParseSummary,
        mockReadLiveSessions,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: NOW, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary({ messageCount: 0 }))
      mockReadLiveSessions.mockReturnValue(registry({ 'session-abc': 'busy' }))

      const result = await scanAllSessions()

      expect(result).toHaveLength(1)
      expect(result[0].isActive).toBe(true)
    })

    it('uses in-memory cache on second call when mtime is unchanged', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 5000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      // First call — should parse
      await scanAllSessions()
      // Second call — same mtime, should use cache
      await scanAllSessions()

      // parseSummary should only be called once (cache hit on second call)
      expect(mockParseSummary).toHaveBeenCalledTimes(1)
    })

    it('re-parses when mtime changes (stale cache)', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      // First call: mtime=1000, second call: mtime=2000 (file changed)
      mockStat
        .mockResolvedValueOnce({ mtimeMs: 1000, size: 1024 })
        .mockResolvedValueOnce({ mtimeMs: 2000, size: 2048 })
      mockParseSummary.mockResolvedValue(makeSummary())

      await scanAllSessions()
      await scanAllSessions()

      // parseSummary called twice because cache was stale on second call
      expect(mockParseSummary).toHaveBeenCalledTimes(2)
    })
  })

  describe('liveness from the process registry', () => {
    async function scanOnce(
      live: LiveSessionsResult,
      mtimeMs: number,
      summary: Partial<SessionSummary> = {},
    ) {
      const {
        scanAllSessions,
        mockScanProjects,
        mockParseSummary,
        mockReadLiveSessions,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary(summary))
      mockReadLiveSessions.mockReturnValue(live)

      return scanAllSessions()
    }

    it('REGRESSION: a brand-new mtime does NOT make a session absent from the registry active', async () => {
      // Fails against the old mtime heuristic: `claude --resume` on a months-old
      // session touched the JSONL and pinned it to the top as "working" forever.
      const result = await scanOnce(registry(), NOW)

      expect(result[0].isActive).toBe(false)
      expect(result[0].sessionState).toBe('inactive')
    })

    it('marks a live idle process as waiting, never working, however fresh the file is', async () => {
      const result = await scanOnce(registry({ 'session-abc': 'idle' }), NOW)

      expect(result[0].sessionState).toBe('waiting')
      // THE INVARIANT: waiting is not active. isActive gates the hidden-project
      // bypass, the stub readmission, the sort pin and the 5s poll.
      expect(result[0].isActive).toBe(false)
    })

    it('marks a live busy process with a recent file as working', async () => {
      const result = await scanOnce(registry({ 'session-abc': 'busy' }), NOW - 60_000)

      expect(result[0].sessionState).toBe('working')
      expect(result[0].isActive).toBe(true)
    })

    it('demotes a busy record whose file has not moved in 6 months', async () => {
      const sixMonths = 180 * 24 * 60 * 60 * 1000
      const result = await scanOnce(registry({ 'session-abc': 'busy' }), NOW - sixMonths)

      expect(result[0].sessionState).toBe('waiting')
      expect(result[0].isActive).toBe(false)
    })

    it('does NOT readmit a content-less stub for a waiting session', async () => {
      const result = await scanOnce(registry({ 'session-abc': 'idle' }), NOW, { messageCount: 0 })

      // Regression guard for commit 18b8b18: only `working` readmits a stub.
      expect(result).toEqual([])
    })

    it('reads the registry exactly once per scan, not once per session', async () => {
      const {
        scanAllSessions,
        mockScanProjects,
        mockParseSummary,
        mockReadLiveSessions,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([
        makeProject({ sessionFiles: ['a.jsonl', 'b.jsonl', 'c.jsonl'] }),
      ])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockImplementation(async (_p, id: string) => makeSummary({ sessionId: id }))

      await scanAllSessions()

      expect(mockReadLiveSessions).toHaveBeenCalledTimes(1)
    })

    it('stats each session file exactly once per scan (no double-stat)', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([
        makeProject({ sessionFiles: ['a.jsonl', 'b.jsonl'] }),
      ])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockImplementation(async (_p, id: string) => makeSummary({ sessionId: id }))

      await scanAllSessions()

      // The detector used to re-stat the exact file the scanner just stat'd.
      expect(mockStat).toHaveBeenCalledTimes(2)
      expect(mockStat).toHaveBeenCalledWith(path.join('/mock/claude/projects', '-Users-user-myproject', 'a.jsonl'))
      expect(mockStat).toHaveBeenCalledWith(path.join('/mock/claude/projects', '-Users-user-myproject', 'b.jsonl'))
      // In particular the persistent subagents dir is never consulted (#29).
      expect(mockStat).not.toHaveBeenCalledWith(path.join('/mock/claude/projects', '-Users-user-myproject', 'a'))
    })

    it('recomputes isActive/sessionState on a cache HIT (no SUMMARY_CACHE_VERSION bump needed)', async () => {
      const {
        scanAllSessions,
        mockScanProjects,
        mockParseSummary,
        mockReadLiveSessions,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: NOW, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      mockReadLiveSessions.mockReturnValue(registry({ 'session-abc': 'busy' }))
      const first = await scanAllSessions()

      mockReadLiveSessions.mockReturnValue(registry({ 'session-abc': 'idle' }))
      const second = await scanAllSessions()

      mockReadLiveSessions.mockReturnValue(registry())
      const third = await scanAllSessions()

      expect(mockParseSummary).toHaveBeenCalledTimes(1) // cache hits after the first
      expect([first[0].sessionState, second[0].sessionState, third[0].sessionState]).toEqual([
        'working',
        'waiting',
        'inactive',
      ])
      expect([first[0].isActive, second[0].isActive, third[0].isActive]).toEqual([true, false, false])
    })

    describe('registry unavailable (legacy mtime fallback)', () => {
      it('keeps the 120s behaviour on the live side of the boundary', async () => {
        const result = await scanOnce(registry({}, false), NOW - 120_000)

        expect(result[0].sessionState).toBe('working')
        expect(result[0].isActive).toBe(true)
      })

      it('keeps the 120s behaviour on the stale side of the boundary', async () => {
        const result = await scanOnce(registry({}, false), NOW - 120_001)

        expect(result[0].sessionState).toBe('inactive')
        expect(result[0].isActive).toBe(false)
      })

      it('still never stats the subagents dir when falling back (#29)', async () => {
        const {
          scanAllSessions,
          mockScanProjects,
          mockParseSummary,
          mockReadLiveSessions,
          mockStat,
        } = await importScanner()

        mockScanProjects.mockResolvedValue([makeProject()])
        mockStat.mockResolvedValue({ mtimeMs: NOW - 600_000, size: 1024 })
        mockParseSummary.mockResolvedValue(makeSummary())
        mockReadLiveSessions.mockReturnValue(registry({}, false))

        const result = await scanAllSessions()

        expect(result[0].isActive).toBe(false)
        expect(mockStat).toHaveBeenCalledTimes(1)
        expect(mockStat).toHaveBeenCalledWith(
          path.join('/mock/claude/projects', '-Users-user-myproject', 'session-abc.jsonl'),
        )
      })
    })
  })

  describe('read-only guarantee', () => {
    it('never writes anything under the claude dir during a scan or a liveness poll', async () => {
      const {
        scanAllSessions,
        getLiveSessionStates,
        mockScanProjects,
        mockParseSummary,
        mockReadLiveSessions,
        mockStat,
        fs,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: NOW, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())
      mockReadLiveSessions.mockReturnValue(registry({ 'session-abc': 'busy' }))

      await scanAllSessions()
      getLiveSessionStates()

      const writeApis = [fs.writeFileSync, fs.renameSync, fs.mkdirSync, fs.unlinkSync] as unknown as ReturnType<typeof vi.fn>[]
      const targets = writeApis.flatMap((api) => api.mock.calls.map((args) => String(args[0])))

      expect(targets.length).toBeGreaterThan(0) // the dashboard's own cache IS written
      for (const target of targets) {
        expect(target.startsWith('/mock/claude')).toBe(false)
      }
    })
  })

  describe('summary cache persistence (only write when something changed)', () => {
    const SUMMARY_CACHE_PATH = path.join('/mock/dashboard-cache', 'session-summaries.json')

    function persistCount(fs: typeof import('node:fs')): number {
      const writeFileSync = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>
      return writeFileSync.mock.calls.filter((args) => String(args[0]).startsWith(SUMMARY_CACHE_PATH)).length
    }

    /** An on-disk cache file in the CURRENT persisted shape. */
    function seedDiskCache(fs: typeof import('node:fs'), version: number, mtimeMs: number) {
      const readFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      readFileSync.mockImplementation(() =>
        JSON.stringify({
          version,
          entries: { 'session-abc': { mtimeMs, summary: makeSummary() } },
        }),
      )
    }

    it('writes when a summary was parsed', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat, fs } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      await scanAllSessions()

      expect(persistCount(fs)).toBe(1)
    })

    it('does NOT write when every entry was a cache hit and nothing was pruned', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat, fs } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      await scanAllSessions() // cold: parses + persists
      const afterFirst = persistCount(fs)
      await scanAllSessions() // pure cache hit

      expect(afterFirst).toBe(1)
      expect(persistCount(fs)).toBe(1)
      expect(mockParseSummary).toHaveBeenCalledTimes(1)
    })

    it('writes when an entry was pruned', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat, fs } = await importScanner()

      mockScanProjects.mockResolvedValue([
        makeProject({ sessionFiles: ['session-abc.jsonl', 'session-gone.jsonl'] }),
      ])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockImplementation(async (_p, id: string) => makeSummary({ sessionId: id }))

      await scanAllSessions()
      const afterFirst = persistCount(fs)

      // session-gone.jsonl disappears: its cache entry must be pruned AND persisted.
      mockScanProjects.mockResolvedValue([makeProject({ sessionFiles: ['session-abc.jsonl'] })])
      await scanAllSessions()

      expect(persistCount(fs)).toBe(afterFirst + 1)
    })

    it('repairs a version-mismatched cache file on the first scan instead of re-parsing forever', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat, fs } = await importScanner()

      seedDiskCache(fs, 3, 1000) // stale version — hydrate must bail out
      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      await scanAllSessions()

      expect(persistCount(fs)).toBe(1)
    })

    it('hydrates a pre-existing v4 cache file and then writes nothing', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat, fs } = await importScanner()

      // SUMMARY_CACHE_VERSION is still 4 — P3 changed no persisted shape.
      seedDiskCache(fs, 4, 1000)
      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      const result = await scanAllSessions()

      expect(result).toHaveLength(1)
      expect(mockParseSummary).not.toHaveBeenCalled()
      expect(persistCount(fs)).toBe(0)
    })
  })

  describe('server-only fields', () => {
    it('scanAllSessions strips both filePath and mtimeMs', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 4242, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      const result = await scanAllSessions()

      expect(result[0]).not.toHaveProperty('filePath')
      expect(result[0]).not.toHaveProperty('mtimeMs')
    })

    it('scanAllSessionsWithPaths carries the JSONL mtimeMs for the stats contribution key', async () => {
      const { scanAllSessionsWithPaths, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 4242, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      const parsed = await scanAllSessionsWithPaths()
      expect(parsed[0].mtimeMs).toBe(4242)

      // ...and on the cache-hit path too, where the value comes from the fresh stat.
      mockStat.mockResolvedValue({ mtimeMs: 4242, size: 1024 })
      const cached = await scanAllSessionsWithPaths()
      expect(mockParseSummary).toHaveBeenCalledTimes(1)
      expect(cached[0].mtimeMs).toBe(4242)
    })
  })

  describe('in-flight scan lock', () => {
    it('coalesces concurrent callers onto one scan (scanProjects runs once)', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      // Both calls start before the first resolves — they must share one scan.
      const [a, b] = await Promise.all([scanAllSessions(), scanAllSessions()])

      expect(mockScanProjects).toHaveBeenCalledTimes(1)
      expect(a).toEqual(b)
      expect(a).toHaveLength(1)
    })

    it('runs a fresh scan after the previous one settles', async () => {
      const { scanAllSessions, mockScanProjects, mockParseSummary, mockStat } = await importScanner()

      mockScanProjects.mockResolvedValue([])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      await scanAllSessions()
      await scanAllSessions()

      // Lock cleared between sequential calls → scanProjects runs each time.
      expect(mockScanProjects).toHaveBeenCalledTimes(2)
    })
  })

  describe('clearSummaryCache', () => {
    it('empties the in-memory cache so the next scan re-parses', async () => {
      const {
        scanAllSessions,
        clearSummaryCache,
        mockScanProjects,
        mockParseSummary,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 7000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      await scanAllSessions() // cold → parse #1
      await scanAllSessions() // cache hit → no new parse
      expect(mockParseSummary).toHaveBeenCalledTimes(1)

      clearSummaryCache() // wipe the Map

      await scanAllSessions() // cache empty → parse #2
      expect(mockParseSummary).toHaveBeenCalledTimes(2)
    })
  })

  describe('scanAllSessionsWithPaths', () => {
    it('returns sessions with filePath included', async () => {
      const {
        scanAllSessionsWithPaths,
        mockScanProjects,
        mockParseSummary,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([makeProject()])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      const result = await scanAllSessionsWithPaths()

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('filePath')
      expect(result[0].filePath).toContain('session-abc.jsonl')
    })

    it('returns [] when there are no projects', async () => {
      const { scanAllSessionsWithPaths, mockScanProjects } = await importScanner()
      mockScanProjects.mockResolvedValue([])

      const result = await scanAllSessionsWithPaths()

      expect(result).toEqual([])
    })

    it('filePath contains the project dirName and session filename', async () => {
      const {
        scanAllSessionsWithPaths,
        mockScanProjects,
        mockParseSummary,
        mockStat,
      } = await importScanner()

      mockScanProjects.mockResolvedValue([
        makeProject({ dirName: '-Users-user-myproject', sessionFiles: ['session-abc.jsonl'] }),
      ])
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 1024 })
      mockParseSummary.mockResolvedValue(makeSummary())

      const result = await scanAllSessionsWithPaths()

      expect(result[0].filePath).toContain('-Users-user-myproject')
      expect(result[0].filePath).toContain('session-abc.jsonl')
    })
  })

  describe('getLiveSessionStates', () => {
    it('returns [] when the registry is unavailable', async () => {
      const { getLiveSessionStates, mockReadLiveSessions } = await importScanner()
      mockReadLiveSessions.mockReturnValue(registry({}, false))

      expect(getLiveSessionStates()).toEqual([])
    })

    it('returns [] when no process is live', async () => {
      const { getLiveSessionStates } = await importScanner()

      expect(getLiveSessionStates()).toEqual([])
    })

    it('maps busy to working and everything else to waiting', async () => {
      const { getLiveSessionStates, mockReadLiveSessions } = await importScanner()
      mockReadLiveSessions.mockReturnValue(
        registry({ 'session-busy': 'busy', 'session-idle': 'idle', 'session-huh': 'unknown' }),
      )

      expect(getLiveSessionStates()).toEqual([
        { sessionId: 'session-busy', sessionState: 'working' },
        { sessionId: 'session-idle', sessionState: 'waiting' },
        { sessionId: 'session-huh', sessionState: 'waiting' },
      ])
    })

    it('never triggers a session scan', async () => {
      const { getLiveSessionStates, mockScanProjects, mockReadLiveSessions } = await importScanner()
      mockReadLiveSessions.mockReturnValue(registry({ 'session-abc': 'busy' }))

      getLiveSessionStates()

      // The old getActiveSessions() ran a full 454-file scan every 3 seconds.
      expect(mockScanProjects).not.toHaveBeenCalled()
    })
  })
})
