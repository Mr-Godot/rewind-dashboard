import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'

// Route claude-path at the fixture dir BEFORE any import evaluates it.
const ctx = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports -- hoisted runs before ESM imports */
  const os = require('node:os') as typeof import('node:os')
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-sqlite-'))
  const projectsDir = path.join(root, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  process.env.CLAUDE_HOME = root
  return { root, projectsDir }
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import { SqliteSearchProvider, sanitizeFtsQuery } from './sqlite-provider'
import { loadSqliteDriver } from './sqlite-driver'

let dbCounter = 0
const openProviders: SqliteSearchProvider[] = []

function newProvider(): SqliteSearchProvider {
  const dbPath = path.join(ctx.root, `idx-${dbCounter++}.db`)
  const p = new SqliteSearchProvider({ dbPath, throttleMs: 0 })
  openProviders.push(p)
  return p
}

// --- JSONL message builders ---
const userText = (ts: string, text: string) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'text', text }] } })
const asstText = (ts: string, text: string) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }] } })
const asstThinking = (ts: string, text: string) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'thinking', thinking: text }] } })
const asstToolUse = (ts: string, name: string, input: object) => ({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', name, id: 'tu', input }] } })
const userToolResult = (ts: string, text: string) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: [{ type: 'text', text }] }] } })
/** A message with no timestamp at all — indexed with ts = ''. */
const userTextNoTs = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })

function writeSession(dir: string, sessionId: string, lines: object[]): string {
  const dirPath = path.join(ctx.projectsDir, dir)
  fs.mkdirSync(dirPath, { recursive: true })
  const file = path.join(dirPath, `${sessionId}.jsonl`)
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8')
  return file
}

function clearProjects(): void {
  for (const entry of fs.readdirSync(ctx.projectsDir)) {
    fs.rmSync(path.join(ctx.projectsDir, entry), { recursive: true, force: true })
  }
}

beforeAll(() => {
  // Confirm the native driver is loadable; these tests require it.
  const probe = loadSqliteDriver(':memory:')
  expect(probe).not.toBeNull()
  probe?.close()
})

afterAll(() => {
  fs.rmSync(ctx.root, { recursive: true, force: true })
})

beforeEach(() => {
  clearProjects()
})

afterEach(() => {
  for (const p of openProviders.splice(0)) p.close()
})

describe('SqliteSearchProvider.refresh (incremental)', () => {
  it('indexes new files, then skips unchanged on the next refresh', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'alpha bravo charlie')])
    writeSession('-Users-a-proj', 'sess-b', [userText('t1', 'delta echo foxtrot')])

    const provider = newProvider()
    const first = await provider.refresh()
    expect(first.sessionsIndexed).toBe(2)
    expect(first.sessionsSkipped).toBe(0)
    expect(first.blocksIndexed).toBe(2)

    const second = await provider.refresh()
    expect(second.sessionsIndexed).toBe(0)
    expect(second.sessionsSkipped).toBe(2)
  })

  it('reindexes a file whose mtime changed and finds the new content', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'alpha bravo')])
    writeSession('-Users-a-proj', 'sess-b', [userText('t1', 'delta echo')])

    const provider = newProvider()
    await provider.refresh()

    const file = writeSession('-Users-a-proj', 'sess-a', [userText('t2', 'newterm zulu')])
    const future = new Date(Date.now() + 10_000)
    fs.utimesSync(file, future, future)

    const stats = await provider.refresh()
    expect(stats.sessionsIndexed).toBe(1)
    expect(stats.sessionsSkipped).toBe(1)

    const res = await provider.search({ query: 'newterm' })
    expect(res.hits.map((h) => h.sessionId)).toContain('sess-a')

    const stale = await provider.search({ query: 'alpha' })
    expect(stale.hits).toHaveLength(0)
  })

  it('removes sessions that disappeared from disk', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'keepterm')])
    const removable = writeSession('-Users-a-proj', 'sess-b', [userText('t1', 'goneterm')])

    const provider = newProvider()
    await provider.refresh()

    fs.rmSync(removable)
    const stats = await provider.refresh()
    expect(stats.sessionsRemoved).toBe(1)

    const res = await provider.search({ query: 'goneterm' })
    expect(res.hits).toHaveLength(0)
    const kept = await provider.search({ query: 'keepterm' })
    expect(kept.hits).toHaveLength(1)
  })

  it('coalesces concurrent refresh calls onto ONE indexing pass', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'alpha bravo')])
    writeSession('-Users-a-proj', 'sess-b', [userText('t1', 'delta echo')])

    const provider = newProvider()
    const [first, second] = await Promise.all([provider.refresh(), provider.refresh()])

    // Same promise, so the same stats object: the second caller never started
    // a second pass against the synchronous write lock.
    expect(second).toBe(first)
    expect(first.sessionsIndexed).toBe(2)
    expect(first.sessionsSkipped).toBe(0)
  })

  it('does NOT satisfy a forced refresh with an in-flight non-forced pass', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'alpha bravo')])
    writeSession('-Users-a-proj', 'sess-b', [userText('t1', 'delta echo')])

    const provider = newProvider()
    // The forced call is issued while the plain pass is still running. Sharing
    // that pass makes a rebuild silently no-op, because it skips unchanged files.
    const plain = provider.refresh()
    const forced = provider.refresh({ force: true })

    const [plainStats, forcedStats] = await Promise.all([plain, forced])

    expect(forcedStats).not.toBe(plainStats)
    expect(plainStats.sessionsIndexed).toBe(2)
    // A real forced pass reindexes every file rather than skipping them.
    expect(forcedStats.sessionsIndexed).toBe(2)
    expect(forcedStats.sessionsSkipped).toBe(0)

    // The queued pass still leaves a consistent, searchable index.
    const res = await provider.search({ query: 'alpha' })
    expect(res.hits.map((h) => h.sessionId)).toEqual(['sess-a'])
  })

  it('still coalesces a non-forced call onto an in-flight forced pass', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'alpha bravo')])

    const provider = newProvider()
    const forced = provider.refresh({ force: true })
    const plain = provider.refresh()

    expect(await plain).toBe(await forced)
  })

  it('throttles from the END of the previous pass, not its start', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'alpha bravo')])
    writeSession('-Users-a-proj', 'sess-b', [userText('t1', 'delta echo')])

    const dbPath = path.join(ctx.root, `idx-throttle-${dbCounter++}.db`)
    const provider = new SqliteSearchProvider({ dbPath, throttleMs: 5000 })
    openProviders.push(provider)

    let clock = 100_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      // The pass STARTS at t=100s and "takes" 39s.
      const pass = provider.refresh()
      clock = 139_000
      const first = await pass
      expect(first.sessionsIndexed).toBe(2)

      // Issued immediately after the pass ended: must be throttled. Measuring
      // the throttle from the pass START would let this one run.
      const second = await provider.refresh()
      expect(second.sessionsIndexed).toBe(0)
      expect(second.sessionsSkipped).toBe(0)

      // force is never throttled.
      const forced = await provider.refresh({ force: true })
      expect(forced.sessionsIndexed).toBe(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('yields to the event loop during a long pass and still prunes stale sessions', async () => {
    // More than one YIELD_EVERY_FILES window so at least one yield happens.
    for (let i = 0; i < 30; i++) {
      writeSession('-Users-a-proj', `sess-${String(i).padStart(2, '0')}`, [
        userText('t1', `yieldterm body ${i}`),
      ])
    }

    const provider = newProvider()
    const immediateSpy = vi.spyOn(globalThis, 'setImmediate')
    try {
      await provider.refresh()
      expect(immediateSpy.mock.calls.length).toBeGreaterThan(0)
    } finally {
      immediateSpy.mockRestore()
    }

    fs.rmSync(path.join(ctx.projectsDir, '-Users-a-proj', 'sess-07.jsonl'))
    const stats = await provider.refresh()
    expect(stats.sessionsRemoved).toBe(1)

    const res = await provider.search({ query: 'yieldterm', limit: 100 })
    expect(res.hits.map((h) => h.sessionId)).not.toContain('sess-07')
    expect(res.total).toBe(29)
  })

  it('rebuilds the index when the schema version changes', async () => {
    const dbPath = path.join(ctx.root, `idx-schema-${dbCounter++}.db`)
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'schematerm')])

    const p1 = new SqliteSearchProvider({ dbPath, throttleMs: 0 })
    await p1.refresh()
    expect((await p1.search({ query: 'schematerm' })).hits).toHaveLength(1)
    p1.close()

    // Tamper with the stored schema version to simulate an upgrade.
    const raw = loadSqliteDriver(dbPath)!
    raw.prepare("UPDATE meta SET value='0' WHERE key='schema_version'").run()
    const blocksBefore = (raw.prepare('SELECT COUNT(*) c FROM blocks_src').get() as { c: number }).c
    expect(blocksBefore).toBeGreaterThan(0)
    raw.close()

    // Re-opening must drop and rebuild: the old rows are gone until refreshed.
    const p2 = new SqliteSearchProvider({ dbPath, throttleMs: 0 })
    expect(p2.isAvailable()).toBe(true)
    expect((await p2.search({ query: 'schematerm' })).hits).toHaveLength(0)
    await p2.refresh()
    expect((await p2.search({ query: 'schematerm' })).hits).toHaveLength(1)
    p2.close()
  })
})

describe('SqliteSearchProvider.search', () => {
  // The fixtures carry DISTINCT timestamps on purpose: when both shared 't1'
  // this assertion held under any ordering and proved nothing.
  it('orders newest-first even when the oldest session has the best bm25 score', async () => {
    writeSession('-Users-a-proj', 'sess-recent', [
      userText('2026-05-02T00:00:00.000Z', 'needle in a big haystack of many other words here'),
    ])
    writeSession('-Users-a-proj', 'sess-old-best', [
      userText('2026-05-01T00:00:00.000Z', 'needle needle needle'),
    ])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'needle' })

    expect(res.total).toBe(2)
    expect(res.hits.map((h) => h.sessionId)).toEqual(['sess-recent', 'sess-old-best'])
    // bm25 is still computed and still says the older session is the better
    // match; recency simply outranks it.
    expect(res.hits[1].score ?? 0).toBeLessThan(res.hits[0].score ?? 0)
    expect(res.hits[0].snippet.toLowerCase()).toContain('needle')
    expect(res.provider).toBe('sqlite')
  })

  it('returns hits in strictly non-increasing timestamp order', async () => {
    writeSession('-Users-a-proj', 'sess-mid', [userText('2026-03-05T00:00:00.000Z', 'sortterm here')])
    writeSession('-Users-a-proj', 'sess-new', [userText('2026-07-09T00:00:00.000Z', 'sortterm here')])
    writeSession('-Users-a-proj', 'sess-old', [userText('2026-01-02T00:00:00.000Z', 'sortterm here')])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'sortterm' })

    expect(res.hits.map((h) => h.sessionId)).toEqual(['sess-new', 'sess-mid', 'sess-old'])
    for (let i = 1; i < res.hits.length; i++) {
      expect(res.hits[i - 1].timestamp >= res.hits[i].timestamp).toBe(true)
    }
  })

  it('with a limit, returns the NEWEST sessions rather than the most relevant', async () => {
    // The highest-bm25 session is deliberately the OLDEST, otherwise the
    // assertion would pass under a relevance sort too.
    writeSession('-Users-a-proj', 'sess-old-best', [
      userText('2026-01-01T00:00:00.000Z', 'limitterm limitterm limitterm'),
    ])
    writeSession('-Users-a-proj', 'sess-mid', [
      userText('2026-02-01T00:00:00.000Z', 'limitterm buried in a much longer body of other words'),
    ])
    writeSession('-Users-a-proj', 'sess-new', [
      userText('2026-03-01T00:00:00.000Z', 'limitterm buried in a much longer body of other words'),
    ])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'limitterm', limit: 2 })

    expect(res.hits.map((h) => h.sessionId)).toEqual(['sess-new', 'sess-mid'])
    expect(res.total).toBe(3)
  })

  it('represents a session by its MOST RECENT match, so timestamp and snippet agree', async () => {
    writeSession('-Users-a-proj', 'sess-drift', [
      // Best bm25 block, but old.
      userText('2026-01-01T00:00:00.000Z', 'driftterm driftterm driftterm oldmarker'),
      // Newest matching block, weaker score.
      asstText('2026-06-01T00:00:00.000Z', 'driftterm recentmarker'),
    ])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'driftterm' })

    expect(res.hits).toHaveLength(1)
    expect(res.hits[0].timestamp).toBe('2026-06-01T00:00:00.000Z')
    expect(res.hits[0].snippet).toContain('recentmarker')
    expect(res.hits[0].snippet).not.toContain('oldmarker')
    expect(res.hits[0].matchCount).toBe(2)
  })

  it('pages deterministically when every session shares a timestamp', async () => {
    for (let i = 0; i < 10; i++) {
      writeSession('-Users-a-proj', `sess-page-${String(i).padStart(2, '0')}`, [
        userText('2026-04-04T00:00:00.000Z', 'pageterm body'),
      ])
    }

    const provider = newProvider()
    await provider.refresh()
    const first = await provider.search({ query: 'pageterm', limit: 5, offset: 0 })
    const second = await provider.search({ query: 'pageterm', limit: 5, offset: 5 })

    const a = first.hits.map((h) => h.sessionId)
    const b = second.hits.map((h) => h.sessionId)
    expect(a).toHaveLength(5)
    expect(b).toHaveLength(5)
    expect(a.filter((id) => b.includes(id))).toEqual([])
    expect(new Set([...a, ...b]).size).toBe(10)
  })

  it('sorts timestamp-less sessions last without dropping or duplicating them', async () => {
    writeSession('-Users-a-proj', 'sess-dated-old', [userText('2026-02-02T00:00:00.000Z', 'blankterm body')])
    writeSession('-Users-a-proj', 'sess-dated-new', [userText('2026-09-09T00:00:00.000Z', 'blankterm body')])
    writeSession('-Users-a-proj', 'sess-blank', [userTextNoTs('blankterm body')])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'blankterm' })

    const ids = res.hits.map((h) => h.sessionId)
    expect(ids).toEqual(['sess-dated-new', 'sess-dated-old', 'sess-blank'])
    expect(new Set(ids).size).toBe(3)
    expect(res.hits[2].timestamp).toBe('')
    expect(res.total).toBe(3)
  })

  it('applies the grouped LIMIT to SESSIONS, not to matching blocks', async () => {
    for (let i = 0; i < 5; i++) {
      writeSession('-Users-a-proj', `sess-cap-${i}`, [
        userText(`2026-0${i + 1}-01T00:00:00.000Z`, 'capterm once'),
        asstText(`2026-0${i + 1}-02T00:00:00.000Z`, 'capterm twice'),
      ])
    }

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'capterm', limit: 3 })

    expect(res.hits).toHaveLength(3)
    expect(new Set(res.hits.map((h) => h.sessionId)).size).toBe(3)
    expect(res.total).toBe(5)
  })

  it('reports matchCount === N for a session with N matching blocks (one hit)', async () => {
    writeSession('-Users-a-proj', 'sess-count', [
      userText('2026-01-01T00:00:00.000Z', 'countterm one'),
      asstText('2026-01-02T00:00:00.000Z', 'countterm two'),
      asstText('2026-01-03T00:00:00.000Z', 'countterm three'),
    ])
    writeSession('-Users-a-proj', 'sess-single', [userText('2026-01-04T00:00:00.000Z', 'countterm alone')])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'countterm' })

    expect(res.hits.filter((h) => h.sessionId === 'sess-count')).toHaveLength(1)
    expect(res.hits.find((h) => h.sessionId === 'sess-count')?.matchCount).toBe(3)
    expect(res.hits.find((h) => h.sessionId === 'sess-single')?.matchCount).toBe(1)
  })

  it('requires all terms (multi-term AND)', async () => {
    writeSession('-Users-a-proj', 'sess-both', [userText('t1', 'apple banana together')])
    writeSession('-Users-a-proj', 'sess-one', [userText('t1', 'apple only')])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'apple banana' })
    expect(res.hits.map((h) => h.sessionId)).toEqual(['sess-both'])
  })

  it('matches token prefixes', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'refactoring the parser')])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'refact' })
    expect(res.hits.map((h) => h.sessionId)).toContain('sess-a')
  })

  it('finds matches inside tool_use, tool_result and thinking blocks', async () => {
    writeSession('-Users-a-proj', 'sess-think', [asstThinking('t1', 'pondering zebraword carefully')])
    writeSession('-Users-a-proj', 'sess-tool', [asstToolUse('t1', 'Bash', { command: 'run giraffeword now' })])
    writeSession('-Users-a-proj', 'sess-result', [userToolResult('t1', 'output was lemurword indeed')])

    const provider = newProvider()
    await provider.refresh()

    const t = await provider.search({ query: 'zebraword' })
    expect(t.hits[0]?.sessionId).toBe('sess-think')
    expect(t.hits[0]?.blockType).toBe('thinking')

    const u = await provider.search({ query: 'giraffeword' })
    expect(u.hits[0]?.sessionId).toBe('sess-tool')
    expect(u.hits[0]?.blockType).toBe('tool_use')

    const r = await provider.search({ query: 'lemurword' })
    expect(r.hits[0]?.sessionId).toBe('sess-result')
    expect(r.hits[0]?.blockType).toBe('tool_result')
  })

  it('filters by blockTypes when requested', async () => {
    writeSession('-Users-a-proj', 'sess-mix', [
      asstText('t1', 'sharedterm in text'),
      asstThinking('t2', 'sharedterm in thinking'),
    ])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'sharedterm', blockTypes: ['thinking'], groupBySession: false })
    expect(res.hits.length).toBeGreaterThan(0)
    expect(res.hits.every((h) => h.blockType === 'thinking')).toBe(true)
  })

  it('groups to one hit per session by default but can return all blocks', async () => {
    writeSession('-Users-a-proj', 'sess-multi', [
      userText('t1', 'matchword once'),
      asstText('t2', 'matchword twice'),
    ])

    const provider = newProvider()
    await provider.refresh()

    const grouped = await provider.search({ query: 'matchword' })
    expect(grouped.hits).toHaveLength(1)
    expect(grouped.hits[0].matchCount).toBe(2)

    const all = await provider.search({ query: 'matchword', groupBySession: false })
    expect(all.hits).toHaveLength(2)
  })

  it('never throws on adversarial FTS metacharacters and returns sane results', async () => {
    writeSession('-Users-a-proj', 'sess-a', [userText('t1', 'legitimate content here')])
    const provider = newProvider()
    await provider.refresh()

    const nasty = ['"', '""', '()', '*', 'AND OR NOT', 'foo*bar', 'a"b', 'NEAR(', ':::', 'content AND', '   ', 'légît']
    for (const q of nasty) {
      const res = await provider.search({ query: q })
      expect(Array.isArray(res.hits)).toBe(true)
      expect(typeof res.total).toBe('number')
    }
  })
})

describe('sanitizeFtsQuery', () => {
  it('wraps bare tokens as quoted prefixes and AND-joins them', () => {
    expect(sanitizeFtsQuery('foo bar')).toBe('"foo"* AND "bar"*')
  })

  it('passes quoted phrases through without a prefix star', () => {
    expect(sanitizeFtsQuery('"exact phrase"')).toBe('"exact phrase"')
  })

  it('escapes embedded quotes and drops empty/metachar-only tokens', () => {
    expect(sanitizeFtsQuery('a"b')).toBe('"a""b"*')
    expect(sanitizeFtsQuery('()')).toBe('')
    expect(sanitizeFtsQuery('   ')).toBe('')
  })
})
