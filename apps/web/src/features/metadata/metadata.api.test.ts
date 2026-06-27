import { describe, it, expect, beforeEach, vi } from 'vitest'

// Sandbox the metadata file behind an in-memory store so nothing touches disk.
vi.mock('node:os', () => ({ homedir: () => '/fake-home' }))

const store = vi.hoisted(() => ({
  content: null as string | null,
  tmp: null as string | null,
}))

vi.mock('node:fs', () => ({
  readFileSync: () => {
    if (store.content == null) {
      const e = new Error('ENOENT') as NodeJS.ErrnoException
      e.code = 'ENOENT'
      throw e
    }
    return store.content
  },
  writeFileSync: (_p: string, data: string) => {
    store.tmp = data
  },
  renameSync: () => {
    store.content = store.tmp
  },
  mkdirSync: () => undefined,
  existsSync: () => false,
  unlinkSync: () => undefined,
  readdirSync: () => [],
}))

import { pruneOrphans } from './metadata.api'
import type { Metadata } from './metadata.types'

describe('pruneOrphans', () => {
  beforeEach(() => {
    store.content = null
    store.tmp = null
  })

  it('removes project keys absent from the current dir names, keeps present ones', () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: { 'sess-1': { pinned: true } },
      projects: {
        'dir-keep': { pinned: true },
        'dir-gone': { hidden: true },
      },
    })

    pruneOrphans(['dir-keep'])

    const written = JSON.parse(store.content!) as Metadata
    expect(written.projects['dir-keep']).toEqual({ pinned: true })
    expect(written.projects['dir-gone']).toBeUndefined()
    // sessions are never touched
    expect(written.sessions).toEqual({ 'sess-1': { pinned: true } })
  })

  it('does not write when nothing is orphaned (no-op)', () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: {},
      projects: { 'dir-a': { pinned: true }, 'dir-b': { hidden: true } },
    })
    store.tmp = null

    pruneOrphans(['dir-a', 'dir-b'])

    // writeMetadataSync was never called, so the staged tmp stays null.
    expect(store.tmp).toBeNull()
  })

  it('never throws when the metadata file is missing', () => {
    store.content = null
    expect(() => pruneOrphans(['dir-a'])).not.toThrow()
  })
})
