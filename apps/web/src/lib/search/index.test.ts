import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Route claude-path at a scratch dir BEFORE any import evaluates it.
vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports -- hoisted runs before ESM imports */
  const os = require('node:os') as typeof import('node:os')
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  /* eslint-enable @typescript-eslint/no-require-imports */
  process.env.CLAUDE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-search-index-'))
})

vi.mock('./sqlite-driver', () => ({
  loadSqliteDriver: vi.fn(() => null),
}))

import { getSearchProvider, resetSearchProvider } from './index'
import { loadSqliteDriver } from './sqlite-driver'

const driverMock = vi.mocked(loadSqliteDriver)

let infoSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetSearchProvider()
  delete process.env.REWIND_SEARCH_PROVIDER
  driverMock.mockReturnValue(null)
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  resetSearchProvider()
  infoSpy.mockRestore()
  warnSpy.mockRestore()
})

describe('getSearchProvider (silent-degrade regression guard)', () => {
  it('falls back to the naive provider when the sqlite driver cannot load', () => {
    expect(getSearchProvider().name).toBe('naive')
  })

  it('logs a REASON for the fallback rather than degrading silently', () => {
    getSearchProvider()

    expect(warnSpy).toHaveBeenCalled()
    const reason = warnSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')
    expect(reason).toContain('[search]')
    expect(reason.toLowerCase()).toContain('naive')
    expect(reason.toLowerCase()).toContain('better-sqlite3')
  })

  it('announces the selected provider exactly once per process', () => {
    getSearchProvider()
    getSearchProvider()
    getSearchProvider()

    const announcements = infoSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('provider ='))
    expect(announcements).toHaveLength(1)
    expect(announcements[0]).toContain('naive')
  })

  it('announces an explicitly selected provider without a fallback warning', () => {
    process.env.REWIND_SEARCH_PROVIDER = 'naive'
    expect(getSearchProvider().name).toBe('naive')

    expect(infoSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('provider ='))).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('memoizes the selected provider', () => {
    expect(getSearchProvider()).toBe(getSearchProvider())
  })
})
