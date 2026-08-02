import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDashboardDir } from './claude-path'
import { getCacheDir } from '../cache/disk-cache'
import { pruneOrphans } from '@/features/metadata/metadata.api'

/**
 * Regression guard for the e2e data-loss bug: playwright.config.ts points the
 * scanner at e2e/fixtures/.claude via CLAUDE_HOME, but every writable path
 * (cache, search index, session summaries, metadata, settings) used to be
 * hardcoded to os.homedir(). An e2e run therefore rewrote the real user's
 * ~/.claude-dashboard state.
 */
describe('dashboard directory isolation', () => {
  let tmpRoot: string
  let fakeHome: string
  let fixtureClaude: string
  const saved: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  beforeEach(() => {
    for (const key of ['USERPROFILE', 'HOME', 'CLAUDE_HOME']) {
      saved[key] = process.env[key]
    }
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-dashdir-'))
    // A space in the segment name exercises Windows paths with spaces.
    fakeHome = path.join(tmpRoot, 'fake home')
    fixtureClaude = path.join(tmpRoot, 'e2e', 'fixtures', '.claude')
    fs.mkdirSync(fakeHome, { recursive: true })
    fs.mkdirSync(fixtureClaude, { recursive: true })
    // os.homedir() reads USERPROFILE on Windows and HOME elsewhere.
    process.env.USERPROFILE = fakeHome
    process.env.HOME = fakeHome
    delete process.env.CLAUDE_HOME
  })

  afterEach(() => {
    for (const key of ['USERPROFILE', 'HOME', 'CLAUDE_HOME']) {
      setEnv(key, saved[key])
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('with CLAUDE_HOME unset (real user, behaviour must not change)', () => {
    it('resolves the dashboard dir to os.homedir()/.claude-dashboard', () => {
      expect(getDashboardDir()).toBe(path.join(os.homedir(), '.claude-dashboard'))
    })

    it('resolves the cache dir to os.homedir()/.claude-dashboard/cache', () => {
      expect(getCacheDir()).toBe(path.join(os.homedir(), '.claude-dashboard', 'cache'))
    })

    it('writes metadata to os.homedir()/.claude-dashboard/session-metadata.json', () => {
      const homeDashboard = path.join(fakeHome, '.claude-dashboard')
      const metadataFile = path.join(homeDashboard, 'session-metadata.json')
      fs.mkdirSync(homeDashboard, { recursive: true })
      fs.writeFileSync(
        metadataFile,
        JSON.stringify({ version: 2, sessions: {}, projects: { orphan: { pinned: true } } }),
        'utf-8',
      )

      pruneOrphans([])

      const after = JSON.parse(fs.readFileSync(metadataFile, 'utf-8')) as {
        projects: Record<string, unknown>
      }
      expect(after.projects).toEqual({})
    })
  })

  describe('with CLAUDE_HOME set (e2e), nothing resolves under the real home', () => {
    beforeEach(() => {
      process.env.CLAUDE_HOME = fixtureClaude
    })

    it('derives the dashboard dir from CLAUDE_HOME, not os.homedir()', () => {
      const expected = path.join(path.dirname(fixtureClaude), '.claude-dashboard')
      expect(getDashboardDir()).toBe(expected)
      expect(getDashboardDir()).not.toBe(path.join(fakeHome, '.claude-dashboard'))
    })

    it('keeps the cache dir (and therefore search-index.db, session-summaries.json, stats-contributions.json) out of the home dir', () => {
      const cacheDir = getCacheDir()
      const homeDashboard = path.join(fakeHome, '.claude-dashboard')
      expect(cacheDir.startsWith(homeDashboard)).toBe(false)
      expect(cacheDir).toBe(
        path.join(path.dirname(fixtureClaude), '.claude-dashboard', 'cache'),
      )
      // The paths derived by consumers all hang off getCacheDir().
      for (const file of [
        'search-index.db',
        'session-summaries.json',
        'stats-contributions.json',
      ]) {
        expect(path.join(cacheDir, file).startsWith(homeDashboard)).toBe(false)
      }
    })

    it('writes metadata under CLAUDE_HOME and never touches the real session-metadata.json', () => {
      const homeDashboard = path.join(fakeHome, '.claude-dashboard')
      const homeMetadata = path.join(homeDashboard, 'session-metadata.json')
      const homeContent = JSON.stringify({
        version: 2,
        sessions: {},
        projects: { 'real-project': { hidden: true } },
      })
      fs.mkdirSync(homeDashboard, { recursive: true })
      fs.writeFileSync(homeMetadata, homeContent, 'utf-8')

      const fixtureDashboard = path.join(path.dirname(fixtureClaude), '.claude-dashboard')
      const fixtureMetadata = path.join(fixtureDashboard, 'session-metadata.json')
      fs.mkdirSync(fixtureDashboard, { recursive: true })
      fs.writeFileSync(
        fixtureMetadata,
        JSON.stringify({ version: 2, sessions: {}, projects: { orphan: { pinned: true } } }),
        'utf-8',
      )

      pruneOrphans([])

      // The fixture copy was pruned...
      const fixtureAfter = JSON.parse(fs.readFileSync(fixtureMetadata, 'utf-8')) as {
        projects: Record<string, unknown>
      }
      expect(fixtureAfter.projects).toEqual({})

      // ...and the real user's hidden/pinned state is byte-identical.
      expect(fs.readFileSync(homeMetadata, 'utf-8')).toBe(homeContent)
    })
  })

  describe('no module bypasses the shared resolver', () => {
    it('never joins os.homedir() with .claude-dashboard anywhere in src/', () => {
      const here = path.dirname(fileURLToPath(import.meta.url))
      const srcDir = path.resolve(here, '..', '..')
      const offenders: string[] = []

      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(full)
          } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            const source = fs.readFileSync(full, 'utf-8')
            if (source.includes('.claude-dashboard') && /homedir\(\)/.test(source)) {
              // claude-path.ts is the one allowed owner of the homedir fallback.
              if (path.basename(full) !== 'claude-path.ts') offenders.push(full)
            }
          }
        }
      }

      walk(srcDir)
      expect(offenders).toEqual([])
    })
  })
})
