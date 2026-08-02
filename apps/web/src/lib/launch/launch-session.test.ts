import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(() => [] as string[]),
  existsSync: vi.fn(() => true),
  openSync: vi.fn(() => 3),
  readSync: vi.fn(() => 0),
  closeSync: vi.fn(),
}))

import * as fs from 'node:fs'
import { resolveLaunchTarget, readRecordedCwd } from './launch-session'

const mockReaddirSync = fs.readdirSync as unknown as ReturnType<typeof vi.fn>
const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>
const mockReadSync = fs.readSync as unknown as ReturnType<typeof vi.fn>

const HOME = 'C:\\Users\\dev'
const PROJECTS = path.join(HOME, '.claude', 'projects')
const SESSION_ID = 'bb968dcf-5394-47a8-abc6-822ee9254871'

/** Make readSync fill the buffer with the given JSONL head. */
function seedHead(lines: string[]) {
  const payload = lines.join('\n')
  mockReadSync.mockImplementation((_fd: number, buf: Buffer) => buf.write(payload, 0, 'utf8'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockReadSync.mockReturnValue(0)
})

describe('readRecordedCwd', () => {
  it('stops at the dir that HOLDS the file instead of scanning every remaining dir', () => {
    mockReaddirSync.mockReturnValue(['dir-a', 'dir-b', 'dir-c', 'dir-d'])
    mockExistsSync.mockImplementation((p: string) => String(p).includes('dir-b'))
    seedHead([JSON.stringify({ type: 'user', cwd: 'C:\\Users\\dev\\_work\\rewind-dashboard' })])

    expect(readRecordedCwd(PROJECTS, SESSION_ID)).toBe('C:\\Users\\dev\\_work\\rewind-dashboard')
    // dir-a, dir-b — then it returns. dir-c/dir-d are never probed.
    expect(mockExistsSync).toHaveBeenCalledTimes(2)
  })

  it('returns null (not the next dir\'s cwd) when the found file records no cwd', () => {
    mockReaddirSync.mockReturnValue(['dir-a', 'dir-b'])
    mockExistsSync.mockImplementation((p: string) => String(p).includes('dir-a'))
    seedHead([JSON.stringify({ type: 'queue-operation' })])

    expect(readRecordedCwd(PROJECTS, SESSION_ID)).toBeNull()
    expect(mockExistsSync).toHaveBeenCalledTimes(1)
  })

  it('skips unparseable head lines', () => {
    mockReaddirSync.mockReturnValue(['dir-a'])
    seedHead(['not json at all', JSON.stringify({ cwd: '/home/u/proj' })])

    expect(readRecordedCwd(PROJECTS, SESSION_ID)).toBe('/home/u/proj')
  })

  it('returns null when the projects dir cannot be read', () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })

    expect(readRecordedCwd(PROJECTS, SESSION_ID)).toBeNull()
  })
})

describe('resolveLaunchTarget', () => {
  it('resolves the recorded cwd for a live session', () => {
    mockReaddirSync.mockReturnValue(['dir-a'])
    seedHead([JSON.stringify({ cwd: 'C:\\Users\\dev\\_work\\rewind-dashboard' })])

    expect(resolveLaunchTarget({ sessionId: SESSION_ID, cwd: 'C:\\stale' }, HOME)).toEqual({
      ok: true,
      sessionId: SESSION_ID,
      sessionCwd: 'C:\\Users\\dev\\_work\\rewind-dashboard',
    })
  })

  it('REGRESSION: returns 409 with the dead path when the recorded cwd no longer exists', () => {
    const dead = 'C:\\Users\\dev\\OneDrive\\_LIVE\\_CODE\\rewind-dashboard'
    mockReaddirSync.mockReturnValue(['dir-a'])
    seedHead([JSON.stringify({ cwd: dead })])
    mockExistsSync.mockImplementation((p: string) => String(p) !== dead)

    const target = resolveLaunchTarget({ sessionId: SESSION_ID, cwd: dead }, HOME)

    // The caller spawns only on ok:true — a dead path used to run
    // `cd /d "<dead>"`, ignore the failure and resume in the wrong scope.
    expect(target.ok).toBe(false)
    expect(target).toMatchObject({ status: 409 })
    expect((target as { error: string }).error).toContain(dead)
  })

  it('falls back to the requested cwd when no JSONL is found', () => {
    mockReaddirSync.mockReturnValue([])

    expect(resolveLaunchTarget({ sessionId: SESSION_ID, cwd: 'C:\\Users\\dev\\_work' }, HOME)).toEqual({
      ok: true,
      sessionId: SESSION_ID,
      sessionCwd: 'C:\\Users\\dev\\_work',
    })
  })

  it('falls back to home when neither a recorded nor a requested cwd exists', () => {
    mockReaddirSync.mockReturnValue([])

    expect(resolveLaunchTarget({ sessionId: SESSION_ID }, HOME)).toEqual({
      ok: true,
      sessionId: SESSION_ID,
      sessionCwd: HOME,
    })
  })

  describe('validation is unchanged (no weakening)', () => {
    it.each([
      ['missing', undefined],
      ['not a uuid', 'not-a-uuid'],
      ['a path', '../../etc/passwd'],
      ['a shell payload', 'a & calc.exe'],
      ['a non-string', 42],
    ])('rejects a sessionId that is %s', (_label, sessionId) => {
      expect(resolveLaunchTarget({ sessionId }, HOME)).toEqual({
        ok: false,
        status: 400,
        error: 'Invalid sessionId: must be a valid UUID',
      })
    })

    it.each([
      ['relative', 'relative/path'],
      ['traversal', 'C:\\Users\\..\\Windows'],
      ['shell metacharacters', 'C:\\Users\\dev & calc.exe'],
      ['a pipe', 'C:\\Users\\dev | whoami'],
    ])('rejects a cwd with %s', (_label, cwd) => {
      const target = resolveLaunchTarget({ sessionId: SESSION_ID, cwd }, HOME)

      expect(target.ok).toBe(false)
      expect(target).toMatchObject({ status: 400 })
    })

    it('rejects a non-string cwd', () => {
      expect(resolveLaunchTarget({ sessionId: SESSION_ID, cwd: 7 }, HOME)).toEqual({
        ok: false,
        status: 400,
        error: 'Invalid cwd: must be a string',
      })
    })

    it('never touches the filesystem for an invalid sessionId', () => {
      resolveLaunchTarget({ sessionId: 'nope' }, HOME)

      expect(mockReaddirSync).not.toHaveBeenCalled()
      expect(mockExistsSync).not.toHaveBeenCalled()
    })
  })
})
