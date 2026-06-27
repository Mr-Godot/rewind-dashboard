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

import { migrateProjectKeys, hideProject, pinProject } from './metadata.api'
import type { Metadata } from './metadata.types'

// All dir names below are Windows-style (double-dash), so decoding is independent
// of homedir. None of them decode to "C:/", so the landmine key is dropped.
const DIR_QUICKFAX = 'C--Users-godot-OneDrive--LIVE--CODE-quickfax'
const DIR_REWIND = 'C--Users-godot--work-rewind-dashboard'
const DIR_EXTRA = 'C--Users-godot--work-extra'
const DIR_NAMES = [DIR_QUICKFAX, DIR_REWIND, DIR_EXTRA]

function makeV1(): Metadata {
  return {
    version: 1,
    sessions: {
      'sess-1': { pinned: true },
      'sess-2': { customName: 'keep me' },
    },
    projects: {
      // decoded-path key with BOTH flags -> remaps + resolves to pinned only
      'C:/Users-godot-OneDrive/LIVE/CODE-quickfax': { pinned: true, hidden: true },
      // decoded-path key -> remaps to its dir
      'C:/Users-godot/work-rewind-dashboard': { hidden: true },
      // already an encoded dir key -> kept as-is (idempotent)
      [DIR_EXTRA]: { pinned: true },
      // 4 stale orphans (no current dir maps here) -> dropped
      'C:/old/dead/one': { hidden: true },
      'C:/old/dead/two': { pinned: true },
      'C:/old/dead/three': { customName: 'x' },
      'C:/old/dead/four': { hidden: true },
      // decoded-path landmine (no current dir decodes to "C:/") -> dropped
      'C:/': { hidden: true },
    },
  }
}

describe('migrateProjectKeys', () => {
  it('remaps decoded-path keys, drops orphans + landmine, resolves pinned+hidden, stamps v2', () => {
    const migrated = migrateProjectKeys(makeV1(), DIR_NAMES)

    expect(migrated.version).toBe(2)

    // Only the three valid encoded dir keys survive
    expect(Object.keys(migrated.projects).sort()).toEqual([...DIR_NAMES].sort())

    // pinned+hidden resolved to pinned only
    expect(migrated.projects[DIR_QUICKFAX]).toEqual({ pinned: true })
    // plain remap preserved
    expect(migrated.projects[DIR_REWIND]).toEqual({ hidden: true })
    // already-encoded key kept
    expect(migrated.projects[DIR_EXTRA]).toEqual({ pinned: true })

    // landmine + orphans gone
    expect(migrated.projects['C:/']).toBeUndefined()
    expect(migrated.projects['C:/old/dead/one']).toBeUndefined()

    // sessions.* untouched
    expect(migrated.sessions).toEqual({
      'sess-1': { pinned: true },
      'sess-2': { customName: 'keep me' },
    })
  })

  it('is idempotent (re-running on a migrated value is a no-op)', () => {
    const once = migrateProjectKeys(makeV1(), DIR_NAMES)
    const twice = migrateProjectKeys(once, DIR_NAMES)
    expect(twice).toEqual(once)
  })

  it('drops a decoded-path key only when no current dir maps to it', () => {
    // When a real dir DOES decode to the key, the value is reattached to that dir.
    const migrated = migrateProjectKeys(
      { version: 1, sessions: {}, projects: { 'C:/Users-godot/work-extra': { hidden: true } } },
      [DIR_EXTRA],
    )
    expect(migrated.projects[DIR_EXTRA]).toEqual({ hidden: true })
    expect(migrated.projects['C:/Users-godot/work-extra']).toBeUndefined()
  })
})

describe('project mutation mutual exclusion', () => {
  beforeEach(() => {
    store.content = null
    store.tmp = null
  })

  it('hideProject clears an existing pin', async () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: {},
      projects: { 'dir-x': { pinned: true } },
    })

    await hideProject({ data: { projectDir: 'dir-x', hidden: true } })

    const written = JSON.parse(store.content!) as Metadata
    expect(written.projects['dir-x']).toEqual({ hidden: true })
  })

  it('pinProject clears an existing hide', async () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: {},
      projects: { 'dir-x': { hidden: true } },
    })

    await pinProject({ data: { projectDir: 'dir-x', pinned: true } })

    const written = JSON.parse(store.content!) as Metadata
    expect(written.projects['dir-x']).toEqual({ pinned: true })
  })
})
