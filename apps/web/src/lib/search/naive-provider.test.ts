import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const ctx = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports -- hoisted runs before ESM imports */
  const os = require('node:os') as typeof import('node:os')
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-naive-'))
  const projectsDir = path.join(root, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  process.env.CLAUDE_HOME = root
  return { root, projectsDir }
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import { NaiveSearchProvider } from './naive-provider'

function writeSession(dir: string, sessionId: string, lines: object[]): void {
  const dirPath = path.join(ctx.projectsDir, dir)
  fs.mkdirSync(dirPath, { recursive: true })
  fs.writeFileSync(path.join(dirPath, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8')
}

beforeAll(() => {
  writeSession('-Users-a-proj', 'sess-text', [
    { type: 'user', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: 'the quick brown FOXTROT jumps' }] } },
  ])
  writeSession('-Users-a-proj', 'sess-toolonly', [
    { type: 'assistant', timestamp: 't1', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', id: 'x', input: { command: 'foxtrot in tool' } }] } },
    { type: 'assistant', timestamp: 't2', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'foxtrot in thinking' }] } },
  ])
  writeSession('-Users-a-proj', 'sess-multi', [
    { type: 'user', timestamp: 't1', message: { role: 'user', content: [{ type: 'text', text: 'first widget line' }] } },
    { type: 'assistant', timestamp: 't2', message: { role: 'assistant', content: [{ type: 'text', text: 'second widget line' }] } },
  ])
})

afterAll(() => {
  fs.rmSync(ctx.root, { recursive: true, force: true })
})

describe('NaiveSearchProvider (parity with the original scan)', () => {
  it('is always available and has a no-op refresh', async () => {
    const provider = new NaiveSearchProvider()
    expect(provider.isAvailable()).toBe(true)
    const stats = await provider.refresh()
    expect(stats.sessionsIndexed).toBe(0)
  })

  it('matches user/assistant text blocks case-insensitively with a snippet', async () => {
    const provider = new NaiveSearchProvider()
    const res = await provider.search({ query: 'foxtrot' })
    const ids = res.hits.map((h) => h.sessionId)
    expect(ids).toContain('sess-text')
    const hit = res.hits.find((h) => h.sessionId === 'sess-text')!
    expect(hit.snippet.toLowerCase()).toContain('foxtrot')
    expect(hit.timestamp).toBe('t1')
  })

  it('ignores tool_use and thinking blocks (text-only, like the original)', async () => {
    const provider = new NaiveSearchProvider()
    const res = await provider.search({ query: 'foxtrot' })
    expect(res.hits.map((h) => h.sessionId)).not.toContain('sess-toolonly')
  })

  it('returns at most one hit per file (first match wins)', async () => {
    const provider = new NaiveSearchProvider()
    const res = await provider.search({ query: 'widget' })
    const multi = res.hits.filter((h) => h.sessionId === 'sess-multi')
    expect(multi).toHaveLength(1)
    expect(multi[0].timestamp).toBe('t1')
  })

  it('respects the limit', async () => {
    const provider = new NaiveSearchProvider()
    const res = await provider.search({ query: 'widget', limit: 1 })
    expect(res.hits.length).toBeLessThanOrEqual(1)
    expect(res.total).toBe(res.hits.length)
  })

  it('returns nothing for too-short queries', async () => {
    const provider = new NaiveSearchProvider()
    const res = await provider.search({ query: 'a' })
    expect(res.hits).toHaveLength(0)
  })
})
