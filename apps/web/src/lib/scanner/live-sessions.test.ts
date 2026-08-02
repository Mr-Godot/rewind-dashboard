import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('@/lib/utils/claude-path', () => ({
  getClaudeDir: vi.fn(() => '/fake/claude'),
}))

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  readLiveSessions,
  resetLiveSessionsCache,
  defaultIsPidAlive,
} from './live-sessions'

const mockReaddir = fs.readdirSync as unknown as ReturnType<typeof vi.fn>
const mockReadFile = fs.readFileSync as unknown as ReturnType<typeof vi.fn>

const SESSIONS_DIR = path.join('/fake/claude', 'sessions')

/** Wire readdirSync/readFileSync to a { filename -> file contents } map. */
function mockSessionsDir(files: Record<string, string>) {
  mockReaddir.mockReturnValue(Object.keys(files))
  mockReadFile.mockImplementation((p: string) => {
    const name = path.basename(String(p))
    if (!(name in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return files[name]
  })
}

const alive = () => true
const dead = () => false

beforeEach(() => {
  vi.clearAllMocks()
  resetLiveSessionsCache()
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('readLiveSessions', () => {
  describe('availability (never gate on map size)', () => {
    it('returns available:false with an empty map when the sessions dir is absent', () => {
      mockReaddir.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      const result = readLiveSessions(alive)

      expect(result.available).toBe(false)
      expect(result.sessions.size).toBe(0)
    })

    it('returns available:false when readdir fails for any other reason', () => {
      mockReaddir.mockImplementation(() => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      })

      expect(readLiveSessions(alive).available).toBe(false)
    })

    it('returns available:TRUE with an empty map when every pid is dead', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
        '222.json': JSON.stringify({ pid: 222, sessionId: 's-2', status: 'idle', updatedAt: 2 }),
      })

      const result = readLiveSessions(dead)

      // The case a naive `size === 0` fallback gate gets wrong: the registry was
      // readable, so callers must NOT fall back to the mtime heuristic.
      expect(result.available).toBe(true)
      expect(result.sessions.size).toBe(0)
    })

    it('warns exactly once per process when the registry is unavailable', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockReaddir.mockImplementation(() => {
        throw new Error('nope')
      })

      readLiveSessions(alive)
      vi.setSystemTime(1_700_000_010_000) // past the memo window
      readLiveSessions(alive)

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        '[live-sessions] ~/.claude/sessions unavailable, falling back to mtime heuristic',
      )
      warn.mockRestore()
    })

    it('reads from <claudeDir>/sessions and only considers .json files', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
      })
      mockReaddir.mockReturnValue(['111.json', 'notes.txt', 'lockfile'])

      const result = readLiveSessions(alive)

      expect(mockReaddir).toHaveBeenCalledWith(SESSIONS_DIR)
      expect(mockReadFile).toHaveBeenCalledTimes(1)
      expect(result.sessions.size).toBe(1)
    })
  })

  describe('pid filtering', () => {
    it('drops records whose pid is not alive and keeps the ones that are', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-live', status: 'busy', updatedAt: 5 }),
        '222.json': JSON.stringify({ pid: 222, sessionId: 's-gone', status: 'idle', updatedAt: 5 }),
      })

      const result = readLiveSessions((pid) => pid === 111)

      expect(result.available).toBe(true)
      expect([...result.sessions.keys()]).toEqual(['s-live'])
    })

    it('treats an EPERM from process.kill as alive (pid owned by another user)', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
      })
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      })

      const result = readLiveSessions()

      expect(result.sessions.has('s-1')).toBe(true)
      expect(kill).toHaveBeenCalledWith(111, 0)
      kill.mockRestore()
    })

    it('treats ESRCH from process.kill as dead', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
      })
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      })

      expect(readLiveSessions().sessions.size).toBe(0)
      kill.mockRestore()
    })

    it('skips records with no numeric pid without probing', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ sessionId: 's-1', status: 'idle', updatedAt: 1 }),
      })
      const probe = vi.fn(() => true)

      const result = readLiveSessions(probe)

      expect(result.available).toBe(true)
      expect(result.sessions.size).toBe(0)
      expect(probe).not.toHaveBeenCalled()
    })
  })

  describe('defaultIsPidAlive', () => {
    it('sends signal 0 only (no real signal) and reports alive on success', () => {
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

      expect(defaultIsPidAlive(4242)).toBe(true)
      expect(kill).toHaveBeenCalledWith(4242, 0)

      kill.mockRestore()
    })

    it('reports alive on EPERM and dead on ESRCH', () => {
      const kill = vi.spyOn(process, 'kill')

      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      })
      expect(defaultIsPidAlive(1)).toBe(true)

      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      })
      expect(defaultIsPidAlive(2)).toBe(false)

      kill.mockRestore()
    })
  })

  describe('malformed input', () => {
    it('skips a malformed JSON file without throwing and still reads the rest', () => {
      mockSessionsDir({
        '111.json': '{ not json at all',
        '222.json': JSON.stringify({ pid: 222, sessionId: 's-ok', status: 'idle', updatedAt: 9 }),
      })

      const result = readLiveSessions(alive)

      expect(result.available).toBe(true)
      expect([...result.sessions.keys()]).toEqual(['s-ok'])
    })

    it('skips a file that cannot be read and keeps going', () => {
      mockReaddir.mockReturnValue(['111.json', '222.json'])
      mockReadFile.mockImplementation((p: string) => {
        if (String(p).endsWith('111.json')) {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        }
        return JSON.stringify({ pid: 222, sessionId: 's-ok', status: 'idle', updatedAt: 9 })
      })

      const result = readLiveSessions(alive)

      expect(result.available).toBe(true)
      expect([...result.sessions.keys()]).toEqual(['s-ok'])
    })

    it('skips records with no sessionId', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, status: 'idle', updatedAt: 1 }),
        '222.json': JSON.stringify({ pid: 222, sessionId: '', status: 'idle', updatedAt: 1 }),
      })

      expect(readLiveSessions(alive).sessions.size).toBe(0)
    })
  })

  describe('duplicate sessionIds', () => {
    it('keeps the record with the newer updatedAt regardless of readdir order', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 'dup', status: 'idle', updatedAt: 100 }),
        '222.json': JSON.stringify({ pid: 222, sessionId: 'dup', status: 'busy', updatedAt: 900 }),
      })

      const newerLast = readLiveSessions(alive)
      expect(newerLast.sessions.size).toBe(1)
      expect(newerLast.sessions.get('dup')?.pid).toBe(222)

      resetLiveSessionsCache()
      mockReaddir.mockReturnValue(['222.json', '111.json'])

      const newerFirst = readLiveSessions(alive)
      expect(newerFirst.sessions.size).toBe(1)
      expect(newerFirst.sessions.get('dup')?.pid).toBe(222)
      expect(newerFirst.sessions.get('dup')?.status).toBe('busy')
    })
  })

  describe('live record shape', () => {
    it('parses the exact on-disk shape, exposing nameSource verbatim', () => {
      mockSessionsDir({
        '19608.json': JSON.stringify({
          pid: 19608,
          sessionId: 'd837ef37-f7f5-4d03-8c06-8f4c14bda38c',
          cwd: 'C:\\Users\\dev\\OneDrive\\_LIVE\\AGENTS',
          startedAt: 1785183490131,
          version: '2.1.220',
          kind: 'interactive',
          entrypoint: 'cli',
          name: 'agents-0a',
          nameSource: 'derived',
          status: 'idle',
          updatedAt: 1785335801404,
          statusUpdatedAt: 1785335801404,
        }),
      })

      const result = readLiveSessions(alive)

      expect(result.available).toBe(true)
      expect(result.sessions.get('d837ef37-f7f5-4d03-8c06-8f4c14bda38c')).toEqual({
        sessionId: 'd837ef37-f7f5-4d03-8c06-8f4c14bda38c',
        pid: 19608,
        status: 'idle',
        name: 'agents-0a',
        nameSource: 'derived',
        cwd: 'C:\\Users\\dev\\OneDrive\\_LIVE\\AGENTS',
        startedAt: 1785183490131,
        updatedAt: 1785335801404,
      })
    })

    it('defaults a missing status and updatedAt rather than dropping the record', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1' }),
      })

      const record = readLiveSessions(alive).sessions.get('s-1')

      expect(record?.status).toBe('unknown')
      expect(record?.updatedAt).toBe(0)
      expect(record?.nameSource).toBeUndefined()
    })
  })

  describe('memoization', () => {
    it('performs one readdir for two calls inside the 1000ms window', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
      })

      const first = readLiveSessions(alive)
      vi.setSystemTime(1_700_000_000_999)
      const second = readLiveSessions(alive)

      expect(mockReaddir).toHaveBeenCalledTimes(1)
      expect(second).toBe(first)
    })

    it('re-reads once the memo window has elapsed', () => {
      mockSessionsDir({
        '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
      })

      readLiveSessions(alive)
      vi.setSystemTime(1_700_000_001_000)
      readLiveSessions(alive)

      expect(mockReaddir).toHaveBeenCalledTimes(2)
    })
  })

  it('never writes: no fs write API is used during a read', () => {
    mockSessionsDir({
      '111.json': JSON.stringify({ pid: 111, sessionId: 's-1', status: 'idle', updatedAt: 1 }),
    })

    // The mocked node:fs module exposes ONLY readdirSync/readFileSync, so a
    // write call (writeFileSync, utimesSync, openSync, ...) would throw here.
    expect(readLiveSessions(alive).sessions.size).toBe(1)
    const writeApis = Object.keys(fs).filter((k) =>
      /write|append|utimes|open|rename|mkdir|unlink|rm/i.test(k),
    )
    expect(writeApis).toEqual([])
  })
})
