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
  it('ranks by bm25 (more occurrences first) and returns a snippet + total', async () => {
    writeSession('-Users-a-proj', 'sess-low', [userText('t1', 'needle in a big haystack of many other words here')])
    writeSession('-Users-a-proj', 'sess-high', [userText('t1', 'needle needle needle')])

    const provider = newProvider()
    await provider.refresh()
    const res = await provider.search({ query: 'needle' })

    expect(res.total).toBe(2)
    expect(res.hits[0].sessionId).toBe('sess-high')
    expect(res.hits[1].sessionId).toBe('sess-low')
    expect((res.hits[0].score ?? 0)).toBeLessThanOrEqual(res.hits[1].score ?? 0)
    expect(res.hits[0].snippet.toLowerCase()).toContain('needle')
    expect(res.provider).toBe('sqlite')
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
