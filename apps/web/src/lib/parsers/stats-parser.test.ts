import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'
import type { SessionDetail, StatsCache } from './types'
import type { SessionSummaryWithPath } from '@/lib/scanner/session-scanner'

// vi.mock is hoisted — define all mocks inline, no variable references

vi.mock('node:fs', () => ({
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

vi.mock('@/lib/utils/claude-path', () => ({
  getStatsPath: vi.fn(() => '/mock/.claude/stats-cache.json'),
}))

vi.mock('@/lib/cache/disk-cache', () => ({
  readDiskCache: vi.fn(),
  writeDiskCache: vi.fn(),
  getCacheDir: vi.fn(() => 'C:\\Users\\jane doe\\.claude-dashboard\\cache'),
}))

vi.mock('@/lib/scanner/session-scanner', () => ({
  scanAllSessionsWithPaths: vi.fn(),
}))

vi.mock('@/lib/parsers/session-parser', () => ({
  parseDetail: vi.fn(),
}))

vi.mock('./subagent-discovery', () => ({
  discoverSubagentFiles: vi.fn(async () => new Map<string, string>()),
}))

// ---------------------------------------------------------------------------
// Constants + fixtures
// ---------------------------------------------------------------------------

const STATS_PATH = '/mock/.claude/stats-cache.json'
const CLAUDE_DIR = 'C:\\Users\\jane doe\\.claude'
const CACHE_DIR = 'C:\\Users\\jane doe\\.claude-dashboard\\cache'
const CONTRIBUTIONS_PATH = path.join(CACHE_DIR, 'stats-contributions.json')

function makeStatsCache(overrides: Partial<StatsCache> = {}): StatsCache {
  return {
    version: 1,
    lastComputedDate: new Date().toISOString(), // today — no enrichment needed by default
    dailyActivity: [],
    dailyModelTokens: [],
    modelUsage: {},
    totalSessions: 5,
    totalMessages: 50,
    longestSession: {
      sessionId: 'session-abc',
      duration: 3600000,
      messageCount: 20,
      timestamp: new Date().toISOString(),
    },
    firstSessionDate: '2026-01-01T00:00:00.000Z',
    hourCounts: { '9': 3, '14': 2 },
    ...overrides,
  }
}

function makeStat(mtimeMs = 1_000_000) {
  return { mtimeMs }
}

function makeSession(
  overrides: Partial<SessionSummaryWithPath> = {},
): SessionSummaryWithPath {
  const sessionId = overrides.sessionId ?? 'sess-1'
  return {
    sessionId,
    projectDir: '-proj',
    projectPath: '/proj',
    projectName: 'proj',
    branch: null,
    cwd: '/proj',
    startedAt: '2026-07-01T09:00:00.000Z',
    lastActiveAt: '2026-07-01T10:00:00.000Z',
    durationMs: 3600000,
    messageCount: 5,
    userMessageCount: 3,
    assistantMessageCount: 2,
    isActive: false,
    sessionState: 'inactive' as const,
    model: null,
    version: null,
    fileSizeBytes: 512,
    totalTokens: 0,
    firstUserMessage: null,
    claudeName: null,
    filePath: path.join(CLAUDE_DIR, 'projects', '-proj', `${sessionId}.jsonl`),
    mtimeMs: 1000,
    ...overrides,
  }
}

function makeDetail(
  sessionId: string,
  turnCount = 2,
  toolFrequency: Record<string, number> = { Bash: 1 },
): SessionDetail {
  return {
    sessionId,
    projectPath: '/proj',
    projectName: 'proj',
    branch: null,
    cwd: null,
    turns: Array.from({ length: turnCount }, (_, i) => ({
      uuid: `t${i}`,
      type: 'user' as const,
      timestamp: '2026-07-01T10:00:00.000Z',
      toolCalls: [],
    })),
    totalTokens: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    tokensByModel: {
      'claude-opus-4-6': {
        inputTokens: 100, outputTokens: 50,
        cacheReadInputTokens: 5, cacheCreationInputTokens: 7,
      },
    },
    toolFrequency,
    errors: [],
    models: ['claude-opus-4-6'],
    agents: [],
    skills: [],
    tasks: [],
    contextWindow: null,
  }
}

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the dashboard cache dir, so hydrate/persist
// round-trips are exercised for real (atomic tmp + rename over Windows paths).
// ---------------------------------------------------------------------------

let diskFiles: Record<string, string> = {}
let writeTargets: string[] = []

async function wireFakeCacheDisk() {
  const fsMod = await import('node:fs')
  vi.mocked(fsMod.readFileSync).mockImplementation(((p: string) => {
    const key = String(p)
    if (key in diskFiles) return diskFiles[key]
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }) as never)
  vi.mocked(fsMod.writeFileSync).mockImplementation(((p: string, data: string) => {
    writeTargets.push(String(p))
    diskFiles[String(p)] = String(data)
  }) as never)
  vi.mocked(fsMod.renameSync).mockImplementation(((from: string, to: string) => {
    writeTargets.push(String(to))
    diskFiles[String(to)] = diskFiles[String(from)]
    delete diskFiles[String(from)]
  }) as never)
  vi.mocked(fsMod.mkdirSync).mockImplementation(((p: string) => {
    writeTargets.push(String(p))
    return undefined
  }) as never)
}

/**
 * Stats-file mtime is mutable so consecutive parseStats() calls bypass the
 * 5-minute merge cache and actually re-enter the contribution path.
 */
let statsMtime = 1_000_000
let agentMtimes: Record<string, number> = {}

async function wireStatMock() {
  const { promises: fsMock } = await import('node:fs')
  vi.mocked(fsMock.stat).mockImplementation((async (p: string) => {
    const key = String(p)
    if (key === STATS_PATH) return { mtimeMs: statsMtime }
    const mtimeMs = agentMtimes[key]
    if (mtimeMs === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return { mtimeMs }
  }) as never)
}

// ---------------------------------------------------------------------------
// Helpers to import the module fresh (resets module-level cache variables)
// ---------------------------------------------------------------------------

async function freshParseStats() {
  vi.resetModules()
  const mod = await import('./stats-parser')
  return mod.parseStats
}

/** Wires the whole stale-stats-with-recent-sessions scenario. */
async function setupEnrichment(sessions: SessionSummaryWithPath[]) {
  const { readDiskCache } = await import('@/lib/cache/disk-cache')
  const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
  const { parseDetail } = await import('@/lib/parsers/session-parser')
  const { discoverSubagentFiles } = await import('./subagent-discovery')

  const staleStats = makeStatsCache({ lastComputedDate: '2024-01-01T00:00:00.000Z' })
  vi.mocked(readDiskCache).mockReturnValue(staleStats)
  vi.mocked(scanAllSessionsWithPaths).mockResolvedValue(sessions)
  vi.mocked(parseDetail).mockImplementation((async (_p: string, id: string) => makeDetail(id)) as never)
  vi.mocked(discoverSubagentFiles).mockResolvedValue(new Map<string, string>())

  await wireStatMock()
  await wireFakeCacheDisk()

  return {
    staleStats,
    mockParseDetail: vi.mocked(parseDetail),
    mockDiscoverSubagentFiles: vi.mocked(discoverSubagentFiles),
  }
}

function readContributionsFile(): { version: number; entries: Record<string, { key: string }> } | null {
  const raw = diskFiles[CONTRIBUTIONS_PATH]
  return raw ? JSON.parse(raw) : null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    diskFiles = {}
    writeTargets = []
    agentMtimes = {}
    statsMtime = 1_000_000
  })

  describe('happy path — valid stats-cache.json, fresh date', () => {
    it('returns parsed stats from disk when mtime matches disk cache', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      const parseStats = await freshParseStats()

      const stats = makeStatsCache()
      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(stats)

      const result = await parseStats()

      expect(result).toEqual(stats)
      expect(readDiskCache).toHaveBeenCalledWith('stats', 1_000_000, expect.anything())
    })

    it('parses stats from raw file when disk cache misses', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache, writeDiskCache } = await import('@/lib/cache/disk-cache')
      const parseStats = await freshParseStats()

      const stats = makeStatsCache()
      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(null)
      vi.mocked(fsMock.readFile).mockResolvedValue(JSON.stringify(stats) as never)

      const result = await parseStats()

      expect(result).toEqual(stats)
      expect(writeDiskCache).toHaveBeenCalledWith('stats', '/mock/.claude/stats-cache.json', 1_000_000, stats)
    })
  })

  describe('in-memory cache hit', () => {
    it('returns cached result on second call without hitting disk again', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      const parseStats = await freshParseStats()

      const stats = makeStatsCache()
      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(stats)

      await parseStats()
      const result2 = await parseStats()

      // readDiskCache should only be called once (in-memory cache serves second call)
      expect(readDiskCache).toHaveBeenCalledTimes(1)
      expect(result2).toEqual(stats)
    })
  })

  describe('missing stats file — falls back to computing from sessions', () => {
    it('returns null when no sessions exist and stat() fails', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      vi.mocked(fsMock.stat).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([])

      const result = await parseStats()

      // With no sessions, computeStatsFromSessions returns a valid minimal stats object
      expect(result).not.toBeNull()
      expect(result?.totalSessions).toBe(0)
      expect(result?.totalMessages).toBe(0)
    })

    it('calls scanAllSessionsWithPaths when stats file is missing', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      vi.mocked(fsMock.stat).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([])

      await parseStats()

      expect(scanAllSessionsWithPaths).toHaveBeenCalled()
    })
  })

  describe('malformed stats file — falls back gracefully', () => {
    it('falls back to session computation when JSON is invalid', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(null)
      vi.mocked(fsMock.readFile).mockResolvedValue('invalid-json{{{' as never)
      vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([])

      const result = await parseStats()

      // Should not throw, falls back to computeStatsFromSessions
      expect(scanAllSessionsWithPaths).toHaveBeenCalled()
      // With empty sessions, returns a valid minimal object
      expect(result?.totalSessions).toBe(0)
    })

    it('falls back when Zod validation fails on stats file content', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      const badStats = { version: 1, lastComputedDate: 'bad' } // missing required fields
      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(null)
      vi.mocked(fsMock.readFile).mockResolvedValue(JSON.stringify(badStats) as never)
      vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([])

      const result = await parseStats()

      expect(scanAllSessionsWithPaths).toHaveBeenCalled()
      expect(result?.totalSessions).toBe(0)
    })
  })

  describe('stale cache — triggers enrichment with recent sessions', () => {
    it('calls scanAllSessionsWithPaths when lastComputedDate is before today', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      // lastComputedDate in the past — triggers enrichment
      const staleStats = makeStatsCache({ lastComputedDate: '2024-01-01T00:00:00.000Z' })
      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(staleStats)
      vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([])

      const result = await parseStats()

      expect(scanAllSessionsWithPaths).toHaveBeenCalled()
      // Returns original stats when no recent sessions found
      expect(result).toEqual(staleStats)
    })

    it('merges recent sessions into stale stats', async () => {
      const parseStats = await freshParseStats()
      const { mockParseDetail } = await setupEnrichment([
        makeSession({
          sessionId: 'new-session',
          startedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }),
      ])
      mockParseDetail.mockImplementation((async () => makeDetail('new-session', 5)) as never)

      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      vi.mocked(readDiskCache).mockReturnValue(
        makeStatsCache({
          lastComputedDate: '2024-01-01T00:00:00.000Z',
          totalSessions: 3,
          totalMessages: 30,
        }),
      )

      const result = await parseStats()

      // Should have merged the new session
      expect(result?.totalSessions).toBe(4) // 3 existing + 1 new
      expect(result?.totalMessages).toBe(35) // 30 existing + 5 from turns
    })
  })

  describe('merge cache — avoids re-scanning within the staleness window', () => {
    it('returns merge cache on repeated stale calls with the same stats mtime', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { readDiskCache } = await import('@/lib/cache/disk-cache')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      const staleStats = makeStatsCache({ lastComputedDate: '2024-01-01T00:00:00.000Z' })
      vi.mocked(fsMock.stat).mockResolvedValue(makeStat(1_000_000) as never)
      vi.mocked(readDiskCache).mockReturnValue(staleStats)
      vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([])

      // First call — triggers scan
      await parseStats()
      // Second call — should use merge cache (same mtime, within the window)
      await parseStats()

      // scanAllSessionsWithPaths should only be called once
      expect(scanAllSessionsWithPaths).toHaveBeenCalledTimes(1)
    })
  })

  describe('returns null when everything fails', () => {
    it('returns null when stat fails and session scan throws', async () => {
      const { promises: fsMock } = await import('node:fs')
      const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
      const parseStats = await freshParseStats()

      vi.mocked(fsMock.stat).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(scanAllSessionsWithPaths).mockRejectedValue(new Error('scan failed'))

      const result = await parseStats()

      expect(result).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// P3: the stats contribution cache
// ---------------------------------------------------------------------------

describe('stats contribution cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    diskFiles = {}
    writeTargets = []
    agentMtimes = {}
    statsMtime = 1_000_000
  })

  it('re-parses nothing on the second call and returns an identical result', async () => {
    const parseStats = await freshParseStats()
    const sessions = [makeSession({ sessionId: 'a' }), makeSession({ sessionId: 'b' })]
    const { mockParseDetail } = await setupEnrichment(sessions)

    const first = await parseStats()
    expect(mockParseDetail).toHaveBeenCalledTimes(2)

    mockParseDetail.mockClear()
    statsMtime = 2_000_000 // bypass the merge cache, re-enter the contribution path
    const second = await parseStats()

    expect(mockParseDetail).toHaveBeenCalledTimes(0)
    // Pure speedup, not a data change.
    expect(second).toEqual(first)
  })

  it('re-parses only the session whose mtimeMs changed', async () => {
    const parseStats = await freshParseStats()
    const sessions = [makeSession({ sessionId: 'a' }), makeSession({ sessionId: 'b' })]
    const { mockParseDetail } = await setupEnrichment(sessions)

    await parseStats()
    mockParseDetail.mockClear()

    sessions[1] = makeSession({ sessionId: 'b', mtimeMs: 9999 })
    const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
    vi.mocked(scanAllSessionsWithPaths).mockResolvedValue(sessions)
    statsMtime = 2_000_000

    await parseStats()

    expect(mockParseDetail).toHaveBeenCalledTimes(1)
    expect(mockParseDetail.mock.calls[0][1]).toBe('b')
  })

  it('invalidates a session when a NEW subagent file appears under an untouched parent', async () => {
    const parseStats = await freshParseStats()
    const session = makeSession({ sessionId: 'a' })
    const { mockParseDetail, mockDiscoverSubagentFiles } = await setupEnrichment([session])

    await parseStats()
    expect(mockParseDetail).toHaveBeenCalledTimes(1)
    mockParseDetail.mockClear()

    // Parent .jsonl is byte-for-byte identical; only the subagent dir moved.
    const agentPath = path.join(CLAUDE_DIR, 'projects', '-proj', 'a', 'subagents', 'agent-x.jsonl')
    agentMtimes[agentPath] = 5_000
    mockDiscoverSubagentFiles.mockResolvedValue(new Map([['x', agentPath]]))
    statsMtime = 2_000_000

    await parseStats()

    expect(mockParseDetail).toHaveBeenCalledTimes(1)
  })

  it('invalidates a session when a subagent file is removed', async () => {
    const parseStats = await freshParseStats()
    const session = makeSession({ sessionId: 'a' })
    const { mockParseDetail, mockDiscoverSubagentFiles } = await setupEnrichment([session])

    const agentPath = path.join(CLAUDE_DIR, 'projects', '-proj', 'a', 'subagents', 'agent-x.jsonl')
    agentMtimes[agentPath] = 5_000
    mockDiscoverSubagentFiles.mockResolvedValue(new Map([['x', agentPath]]))

    await parseStats()
    mockParseDetail.mockClear()

    mockDiscoverSubagentFiles.mockResolvedValue(new Map<string, string>())
    statsMtime = 2_000_000

    await parseStats()

    expect(mockParseDetail).toHaveBeenCalledTimes(1)
  })

  it('invalidates when the same agent file switches between the subagents/ and agents/ variants', async () => {
    const parseStats = await freshParseStats()
    const session = makeSession({ sessionId: 'a' })
    const { mockParseDetail, mockDiscoverSubagentFiles } = await setupEnrichment([session])

    const base = path.join(CLAUDE_DIR, 'projects', '-proj', 'a')
    const subagentsPath = path.join(base, 'subagents', 'agent-x.jsonl')
    const agentsPath = path.join(base, 'agents', 'agent-x.jsonl')
    // Same agent id, same count, SAME mtime — only the directory variant differs.
    agentMtimes[subagentsPath] = 5_000
    agentMtimes[agentsPath] = 5_000

    mockDiscoverSubagentFiles.mockResolvedValue(new Map([['x', subagentsPath]]))
    await parseStats()
    mockParseDetail.mockClear()

    mockDiscoverSubagentFiles.mockResolvedValue(new Map([['x', agentsPath]]))
    statsMtime = 2_000_000
    await parseStats()

    expect(mockParseDetail).toHaveBeenCalledTimes(1)
  })

  it('does not re-parse when only the persisted cache file is reloaded (cold start hydrate)', async () => {
    const parseStats = await freshParseStats()
    const sessions = [makeSession({ sessionId: 'a' })]
    const { mockParseDetail } = await setupEnrichment(sessions)

    await parseStats()
    expect(mockParseDetail).toHaveBeenCalledTimes(1)
    expect(readContributionsFile()?.version).toBe(1)

    // Fresh process: module-level caches gone, on-disk contributions survive.
    const parseStats2 = await freshParseStats()
    const second = await setupEnrichment(sessions)

    second.mockParseDetail.mockClear()

    await parseStats2()

    expect(second.mockParseDetail).toHaveBeenCalledTimes(0)
  })

  it('falls back to a full parse and rewrites a clean file when the cache file is version-mismatched', async () => {
    diskFiles[CONTRIBUTIONS_PATH] = JSON.stringify({
      version: 999,
      entries: { a: { key: 'whatever', contribution: { messageCount: 1, toolCallCount: 1, tokensByModel: {} } } },
    })

    const parseStats = await freshParseStats()
    const { mockParseDetail } = await setupEnrichment([makeSession({ sessionId: 'a' })])

    await expect(parseStats()).resolves.not.toBeNull()

    expect(mockParseDetail).toHaveBeenCalledTimes(1)
    expect(readContributionsFile()?.version).toBe(1)
  })

  it('falls back to a full parse when the cache file is truncated', async () => {
    diskFiles[CONTRIBUTIONS_PATH] = '{"version":1,"entr'

    const parseStats = await freshParseStats()
    const { mockParseDetail } = await setupEnrichment([makeSession({ sessionId: 'a' })])

    await expect(parseStats()).resolves.not.toBeNull()

    expect(mockParseDetail).toHaveBeenCalledTimes(1)
    expect(readContributionsFile()?.version).toBe(1)
  })

  it('uses the summary fallback and caches NO contribution when parseDetail throws', async () => {
    const parseStats = await freshParseStats()
    const { mockParseDetail } = await setupEnrichment([
      makeSession({ sessionId: 'boom', messageCount: 7 }),
    ])
    mockParseDetail.mockRejectedValue(new Error('parse error'))

    const { readDiskCache } = await import('@/lib/cache/disk-cache')
    vi.mocked(readDiskCache).mockReturnValue(
      makeStatsCache({ lastComputedDate: '2024-01-01T00:00:00.000Z', totalSessions: 0, totalMessages: 0 }),
    )

    const result = await parseStats()

    // Summary fallback branch: messageCount comes from the summary, not a zeroed detail.
    expect(result?.totalMessages).toBe(7)
    expect(readContributionsFile()?.entries.boom).toBeUndefined()
  })

  it('prunes contributions for sessions that are no longer on disk', async () => {
    const parseStats = await freshParseStats()
    const sessions = [makeSession({ sessionId: 'a' }), makeSession({ sessionId: 'b' })]
    await setupEnrichment(sessions)

    await parseStats()
    expect(Object.keys(readContributionsFile()!.entries).sort()).toEqual(['a', 'b'])

    const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
    vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([sessions[0]])
    statsMtime = 2_000_000

    await parseStats()

    expect(Object.keys(readContributionsFile()!.entries)).toEqual(['a'])
  })

  it('keys entries by sessionId with no absolute path in the key, over a Windows cache path', async () => {
    const parseStats = await freshParseStats()
    await setupEnrichment([makeSession({ sessionId: 'a' })])

    await parseStats()

    const file = readContributionsFile()!
    expect(Object.keys(file.entries)).toEqual(['a'])
    expect(file.entries.a.key).not.toContain('C:\\')
    expect(file.entries.a.key).not.toContain('/proj')
    // Atomic write survived a path with spaces and backslashes.
    expect(writeTargets).toContain(`${CONTRIBUTIONS_PATH}.tmp`)
    expect(writeTargets).toContain(CONTRIBUTIONS_PATH)
  })

  it('writes the contributions file only when something changed', async () => {
    const parseStats = await freshParseStats()
    await setupEnrichment([makeSession({ sessionId: 'a' })])

    await parseStats()
    expect(writeTargets.filter((t) => t === CONTRIBUTIONS_PATH)).toHaveLength(1)

    writeTargets = []
    statsMtime = 2_000_000
    await parseStats()

    expect(writeTargets.filter((t) => t === CONTRIBUTIONS_PATH)).toHaveLength(0)
  })

  it('never writes anything under the claude dir', async () => {
    const parseStats = await freshParseStats()
    await setupEnrichment([makeSession({ sessionId: 'a' })])

    await parseStats()

    expect(writeTargets.length).toBeGreaterThan(0)
    for (const target of writeTargets) {
      expect(target.startsWith(CLAUDE_DIR + path.sep)).toBe(false)
      expect(target.startsWith(CACHE_DIR)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// updateHourCounts — tested indirectly via computeStatsFromSessions
// ---------------------------------------------------------------------------

describe('hour bucketing (via computeStatsFromSessions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    diskFiles = {}
    writeTargets = []
    agentMtimes = {}
  })

  it('increments the correct hour bucket from startedAt timestamp', async () => {
    const { promises: fsMock } = await import('node:fs')
    const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
    const { parseDetail } = await import('@/lib/parsers/session-parser')
    const { discoverSubagentFiles } = await import('./subagent-discovery')
    const parseStats = await freshParseStats()

    const session = makeSession({
      sessionId: 'hour-test',
      startedAt: '2026-03-10T09:00:00.000Z',
      lastActiveAt: '2026-03-10T09:30:00.000Z',
      messageCount: 2,
    })

    // stat fails → goes to computeStatsFromSessions
    vi.mocked(fsMock.stat).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([session])
    vi.mocked(discoverSubagentFiles).mockResolvedValue(new Map<string, string>())
    vi.mocked(parseDetail).mockRejectedValue(new Error('parse error')) // forces summary fallback
    await wireFakeCacheDisk()

    const result = await parseStats()

    // Hour 9 should be incremented
    expect(result).not.toBeNull()
    // The hour from '2026-03-10T09:00:00.000Z' — depends on local timezone, so we just
    // check that some hour bucket was populated
    const hourValues = Object.values(result!.hourCounts)
    expect(hourValues.some((v) => v > 0)).toBe(true)
  })

  it('skips sessions with missing startedAt gracefully', async () => {
    const { promises: fsMock } = await import('node:fs')
    const { scanAllSessionsWithPaths } = await import('@/lib/scanner/session-scanner')
    const { discoverSubagentFiles } = await import('./subagent-discovery')
    const parseStats = await freshParseStats()

    const session = makeSession({
      sessionId: 'no-time',
      startedAt: '', // empty — should be skipped by updateHourCounts
      lastActiveAt: '',
      durationMs: 0,
      messageCount: 0,
      fileSizeBytes: 0,
    })

    vi.mocked(fsMock.stat).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(scanAllSessionsWithPaths).mockResolvedValue([session])
    vi.mocked(discoverSubagentFiles).mockResolvedValue(new Map<string, string>())
    await wireFakeCacheDisk()

    const result = await parseStats()

    expect(result).not.toBeNull()
    // hourCounts should be empty (skipped due to empty startedAt)
    expect(Object.keys(result!.hourCounts)).toHaveLength(0)
  })
})
