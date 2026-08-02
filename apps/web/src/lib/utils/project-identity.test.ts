import { describe, it, expect } from 'vitest'
import { deriveProjectName, resolveProjectNames, splitPathSegments } from './project-identity'

describe('deriveProjectName', () => {
  it('returns a non-empty name for a drive root (path.basename returns "")', () => {
    // The real `C--` project dir on this machine records cwd `C:\`.
    const name = deriveProjectName('C:\\')

    expect(name).not.toBe('')
    expect(name).toContain('C')
  })

  it('does not collapse a Windows path to one segment', () => {
    expect(deriveProjectName('C:\\Users\\dev\\_work\\rewind-dashboard')).toBe('rewind-dashboard')
  })

  it('does NOT reduce ...\\rewind-dashboard\\apps\\web to "web"', () => {
    const name = deriveProjectName('C:\\Users\\dev\\_work\\rewind-dashboard\\apps\\web')

    expect(name).not.toBe('web')
    expect(name).toContain('rewind-dashboard')
  })

  it('prepends the parent for a purely numeric leaf', () => {
    expect(deriveProjectName('/Users/user/AGENTS/CRM/1')).toBe('CRM/1')
  })

  it('keeps hyphenated names intact (no noise-word stripping)', () => {
    // extractProjectName turns this into 'review'.
    expect(deriveProjectName('/Users/user/code-review')).toBe('code-review')
  })

  it('handles a plain unix path', () => {
    expect(deriveProjectName('/Users/user/myproject')).toBe('myproject')
  })

  it('never returns an empty string for a root path', () => {
    expect(deriveProjectName('/')).not.toBe('')
  })

  it('extraDepth prepends further parents', () => {
    expect(deriveProjectName('C:\\Users\\dev\\_work\\rewind-dashboard', 1)).toBe(
      '_work/rewind-dashboard',
    )
  })
})

describe('splitPathSegments', () => {
  it('splits on both separators', () => {
    expect(splitPathSegments('C:\\a/b\\c')).toEqual(['C:', 'a', 'b', 'c'])
  })
})

describe('resolveProjectNames', () => {
  it('gives two dirs with the same basename two DISTINCT names', () => {
    // The user's actual duplicate-row complaint.
    const names = resolveProjectNames([
      { key: 'C--Users-dev--work-rewind-dashboard', realPath: 'C:\\Users\\dev\\_work\\rewind-dashboard', fallbackName: 'x' },
      { key: 'C--Users-dev--CODE-rewind-dashboard', realPath: 'C:\\Users\\dev\\_CODE\\rewind-dashboard', fallbackName: 'y' },
    ])

    const a = names.get('C--Users-dev--work-rewind-dashboard')
    const b = names.get('C--Users-dev--CODE-rewind-dashboard')
    expect(a).toBe('_work/rewind-dashboard')
    expect(b).toBe('_CODE/rewind-dashboard')
    expect(a).not.toBe(b)
  })

  it('leaves a unique name alone', () => {
    const names = resolveProjectNames([
      { key: 'a', realPath: 'C:\\Users\\dev\\_work\\rewind-dashboard', fallbackName: 'x' },
      { key: 'b', realPath: 'C:\\Users\\dev\\_work\\budget-agent', fallbackName: 'y' },
    ])

    expect(names.get('a')).toBe('rewind-dashboard')
    expect(names.get('b')).toBe('budget-agent')
  })

  it('uses the decoded fallback when no cwd was recorded', () => {
    const names = resolveProjectNames([
      { key: 'a', realPath: null, fallbackName: 'legacy-name' },
    ])

    expect(names.get('a')).toBe('legacy-name')
  })

  it('still produces distinct names when two dirs record the SAME path', () => {
    const names = resolveProjectNames([
      { key: 'dir-one', realPath: 'C:\\proj', fallbackName: 'x' },
      { key: 'dir-two', realPath: 'C:\\proj', fallbackName: 'y' },
    ])

    expect(names.get('dir-one')).not.toBe(names.get('dir-two'))
  })

  it('disambiguates three colliding paths', () => {
    const names = resolveProjectNames([
      { key: 'a', realPath: '/home/u/one/app', fallbackName: 'x' },
      { key: 'b', realPath: '/home/u/two/app', fallbackName: 'y' },
      { key: 'c', realPath: '/home/u/three/app', fallbackName: 'z' },
    ])

    const values = [names.get('a'), names.get('b'), names.get('c')]
    expect(new Set(values).size).toBe(3)
  })
})
