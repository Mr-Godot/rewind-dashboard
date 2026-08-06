import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearDetectionCache, detectTerminalsSync, getResolvedLauncher } from './terminal-detect'
import type { LaunchRecipe } from './terminal-registry'

beforeEach(() => {
  clearDetectionCache()
})

describe('detectTerminalsSync', () => {
  it('returns only profiles whose probe returns true', () => {
    const result = detectTerminalsSync({
      platform: 'win32',
      probe: (r) => r.id === 'pwsh' || r.id === 'cmd',
    })
    expect(result.detected.map((d) => d.id)).toEqual(['pwsh', 'cmd'])
  })

  it('filters by platform: a win32 run returns no macOS or Linux profiles', () => {
    const result = detectTerminalsSync({ platform: 'win32', probe: () => true })
    expect(result.platform).toBe('win32')
    expect(result.detected.map((d) => d.id)).toEqual([
      'wt-pwsh',
      'wt-powershell',
      'pwsh',
      'powershell',
      'cmd',
      'git-bash',
    ])
  })

  it('treats a throwing probe as not detected without failing the whole run', () => {
    const result = detectTerminalsSync({
      platform: 'linux',
      probe: (r: LaunchRecipe) => {
        if (r.id === 'konsole') throw new Error('probe exploded')
        return true
      },
    })
    expect(result.detected.map((d) => d.id)).not.toContain('konsole')
    expect(result.detected.length).toBeGreaterThan(0)
  })

  it('always returns a valid array, possibly empty', () => {
    const result = detectTerminalsSync({ platform: 'linux', probe: () => false })
    expect(result.detected).toEqual([])
    expect(result.autoResolvedId).toBeNull()
  })

  it('resolves autoResolvedId by the platform preference order', () => {
    const result = detectTerminalsSync({
      platform: 'win32',
      probe: (r) => r.id === 'cmd' || r.id === 'powershell',
    })
    expect(result.autoResolvedId).toBe('powershell')
  })

  it('caches for the life of the process and re-probes only on force', () => {
    const probe = vi.fn(() => true)
    detectTerminalsSync({ platform: 'win32', probe })
    const callsAfterFirst = probe.mock.calls.length
    detectTerminalsSync({ platform: 'win32', probe })
    expect(probe.mock.calls.length).toBe(callsAfterFirst)

    detectTerminalsSync({ platform: 'win32', probe, force: true })
    expect(probe.mock.calls.length).toBe(callsAfterFirst * 2)
  })

  it('keeps a file-probe launcher path in memory only', () => {
    const minttyPath = 'C:\\Program Files\\Git\\usr\\bin\\mintty.exe'
    detectTerminalsSync({
      platform: 'win32',
      probe: (r) => (r.id === 'git-bash' ? minttyPath : false),
    })
    expect(getResolvedLauncher('git-bash')).toBe(minttyPath)
    expect(getResolvedLauncher('pwsh')).toBeUndefined()
  })
})
