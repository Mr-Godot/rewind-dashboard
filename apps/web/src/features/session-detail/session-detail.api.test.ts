import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(() => [] as string[]),
  existsSync: vi.fn(() => false),
}))

vi.mock('@/lib/utils/claude-path', () => ({
  getProjectsDir: vi.fn(() => '/mock/claude/projects'),
  decodeProjectDirName: vi.fn((dirName: string) => `/decoded/${dirName}`),
}))

import * as fs from 'node:fs'
import { findSessionFile, resolveDetailProjectName } from './session-detail.api'
import { deriveProjectName } from '@/lib/utils/project-identity'

const mockReaddirSync = fs.readdirSync as unknown as ReturnType<typeof vi.fn>
const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findSessionFile (unchanged by the projectPath/realPath split)', () => {
  it('locates the session via the PRIMARY decoded-path match without entering the fallback loop', () => {
    mockReaddirSync.mockReturnValue(['dir-a', 'dir-b', 'dir-c'])
    // Only the file inside the matching dir exists.
    mockExistsSync.mockImplementation((p: string) => String(p).includes('dir-b'))

    const found = findSessionFile('sess-1', '/decoded/dir-b')

    expect(found).toEqual({
      path: path.join('/mock/claude/projects', 'dir-b', 'sess-1.jsonl'),
      dirName: 'dir-b',
    })
    // Primary loop only probes the ONE matching dir. The 44-dir fallback readdir
    // scan would have probed every dir.
    expect(mockExistsSync).toHaveBeenCalledTimes(1)
  })

  it('still matches on the encoded dir name', () => {
    mockReaddirSync.mockReturnValue(['dir-a', 'dir-b'])
    mockExistsSync.mockImplementation((p: string) => String(p).includes('dir-a'))

    expect(findSessionFile('sess-1', 'dir-a')?.dirName).toBe('dir-a')
    expect(mockExistsSync).toHaveBeenCalledTimes(1)
  })

  it('falls back to scanning every dir when the projectPath does not match', () => {
    mockReaddirSync.mockReturnValue(['dir-a', 'dir-b'])
    mockExistsSync.mockImplementation((p: string) => String(p).includes('dir-b'))

    expect(findSessionFile('sess-1', '/decoded/not-a-real-dir')?.dirName).toBe('dir-b')
  })

  it('returns null when the projects dir cannot be read', () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })

    expect(findSessionFile('sess-1', '/decoded/dir-a')).toBeNull()
  })
})

describe('resolveDetailProjectName', () => {
  it('is exactly the list-side rule applied to the recorded cwd (list/detail parity)', () => {
    const cwd = 'C:\\Users\\dev\\_work\\rewind-dashboard'

    expect(resolveDetailProjectName(cwd, '/decoded/whatever')).toBe(deriveProjectName(cwd))
    expect(resolveDetailProjectName(cwd, '/decoded/whatever')).toBe('rewind-dashboard')
  })

  it('does NOT strip a leading noise word off a real directory name', () => {
    // extractProjectName turns 'code-review' into 'review'.
    expect(resolveDetailProjectName('/home/u/code-review', '/decoded/x')).toBe('code-review')
  })

  it('falls back to the decoded path only when no cwd was recorded', () => {
    expect(resolveDetailProjectName(null, '/decoded/C--Users-u-myproject')).toBe(
      'C--Users-u-myproject',
    )
  })
})
