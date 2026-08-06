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

import { migrateProjectKeys, hideProject, pinProject, hideSession, pinSession } from './metadata.api'
import { MetadataSchema } from './metadata.types'
import type { Metadata } from './metadata.types'

// All dir names below are Windows-style (double-dash), so decoding is independent
// of homedir. None of them decode to "C:/", so the landmine key is dropped.
const DIR_PHOTOAPP = 'C--Users-dev-OneDrive--LIVE--CODE-photoapp'
const DIR_REWIND = 'C--Users-dev--work-rewind-dashboard'
const DIR_EXTRA = 'C--Users-dev--work-extra'
const DIR_NAMES = [DIR_PHOTOAPP, DIR_REWIND, DIR_EXTRA]

function makeV1(): Metadata {
  return {
    version: 1,
    sessions: {
      'sess-1': { pinned: true },
      'sess-2': { customName: 'keep me' },
    },
    projects: {
      // decoded-path key with BOTH flags -> remaps + resolves to pinned only
      'C:/Users-dev-OneDrive/LIVE/CODE-photoapp': { pinned: true, hidden: true },
      // decoded-path key -> remaps to its dir
      'C:/Users-dev/work-rewind-dashboard': { hidden: true },
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
    expect(migrated.projects[DIR_PHOTOAPP]).toEqual({ pinned: true })
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
      { version: 1, sessions: {}, projects: { 'C:/Users-dev/work-extra': { hidden: true } } },
      [DIR_EXTRA],
    )
    expect(migrated.projects[DIR_EXTRA]).toEqual({ hidden: true })
    expect(migrated.projects['C:/Users-dev/work-extra']).toBeUndefined()
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

describe('session hidden field', () => {
  beforeEach(() => {
    store.content = null
    store.tmp = null
  })

  it('loads a pre-existing v2 file that has no session hidden field, unchanged', () => {
    const parsed = MetadataSchema.parse({
      version: 2,
      sessions: { 'sess-1': { pinned: true }, 'sess-2': { customName: 'keep me' } },
      projects: { 'dir-x': { hidden: true } },
    })

    expect(parsed.version).toBe(2)
    expect(parsed.sessions['sess-1']).toEqual({ pinned: true })
    expect(parsed.sessions['sess-1'].hidden).toBeUndefined()
    expect(parsed.projects['dir-x']).toEqual({ hidden: true })
  })

  it('accepts hidden on a session without bumping the file version', () => {
    const parsed = MetadataSchema.parse({
      version: 2,
      sessions: { 'sess-1': { hidden: true, customName: 'keep me' } },
      projects: {},
    })

    expect(parsed.version).toBe(2)
    expect(parsed.sessions['sess-1']).toEqual({ hidden: true, customName: 'keep me' })
  })

  it('hideSession writes only the target session and leaves projects untouched', async () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: { 'sess-1': { customName: 'keep me' }, 'sess-2': { pinned: true } },
      projects: { 'dir-x': { pinned: true } },
    })

    await hideSession({ data: { sessionId: 'sess-1', hidden: true } })

    const written = JSON.parse(store.content!) as Metadata
    expect(written.version).toBe(2)
    expect(written.sessions['sess-1']).toEqual({ customName: 'keep me', hidden: true })
    expect(written.sessions['sess-2']).toEqual({ pinned: true })
    // Hiding a session must never touch its project.
    expect(written.projects).toEqual({ 'dir-x': { pinned: true } })
  })

  it('hideProject leaves every session entry untouched', async () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: { 'sess-1': { pinned: true } },
      projects: {},
    })

    await hideProject({ data: { projectDir: 'dir-x', hidden: true } })

    const written = JSON.parse(store.content!) as Metadata
    expect(written.sessions).toEqual({ 'sess-1': { pinned: true } })
    expect(written.sessions['sess-1'].hidden).toBeUndefined()
  })

  it('unhiding drops the flag and prunes an entry that holds nothing else', async () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: { 'sess-1': { hidden: true } },
      projects: {},
    })

    await hideSession({ data: { sessionId: 'sess-1', hidden: false } })

    const written = JSON.parse(store.content!) as Metadata
    expect(written.sessions['sess-1']).toBeUndefined()
  })

  it('session pin and hide stay mutually exclusive, like projects', async () => {
    store.content = JSON.stringify({
      version: 2,
      sessions: { 'sess-1': { pinned: true } },
      projects: {},
    })

    await hideSession({ data: { sessionId: 'sess-1', hidden: true } })
    expect((JSON.parse(store.content!) as Metadata).sessions['sess-1']).toEqual({ hidden: true })

    await pinSession({ data: { sessionId: 'sess-1', pinned: true } })
    expect((JSON.parse(store.content!) as Metadata).sessions['sess-1']).toEqual({ pinned: true })
  })

  it('migrateProjectKeys carries session hidden flags through the v1 to v2 remap', () => {
    const migrated = migrateProjectKeys(
      {
        version: 1,
        sessions: { 'sess-1': { hidden: true }, 'sess-2': { pinned: true } },
        projects: { 'C:/Users-dev/work-extra': { hidden: true } },
      },
      [DIR_EXTRA],
    )

    expect(migrated.version).toBe(2)
    expect(migrated.sessions).toEqual({ 'sess-1': { hidden: true }, 'sess-2': { pinned: true } })
  })
})
