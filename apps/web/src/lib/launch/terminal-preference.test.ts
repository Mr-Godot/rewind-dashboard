import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readTerminalPreferenceSync, resolveRecipe } from './terminal-preference'

const WIN_DETECTED = ['wt-pwsh', 'pwsh', 'powershell', 'cmd', 'git-bash']

function resolve(overrides: Partial<Parameters<typeof resolveRecipe>[0]> = {}) {
  return resolveRecipe({
    saved: undefined,
    detectedIds: WIN_DETECTED,
    platform: 'win32',
    ...overrides,
  })
}

describe('resolveRecipe', () => {
  it('refuses to guess when nothing was ever chosen', () => {
    const decision = resolve({ saved: undefined })
    expect(decision).toEqual({ ok: false, status: 428, error: 'No terminal chosen' })
  })

  it("resolves 'auto' by preference order and never confuses it with absent", () => {
    const decision = resolve({ saved: 'auto' })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.recipe.id).toBe('wt-pwsh')

    const narrower = resolve({ saved: 'auto', detectedIds: ['cmd', 'powershell'] })
    expect(narrower.ok).toBe(true)
    if (narrower.ok) expect(narrower.recipe.id).toBe('powershell')
  })

  it('uses a saved id that is still detected', () => {
    const decision = resolve({ saved: 'git-bash' })
    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.recipe.id).toBe('git-bash')
      expect(decision.warning).toBeUndefined()
    }
  })

  it('falls back to auto with a warning when the saved id is gone, and never 428s', () => {
    const decision = resolve({ saved: 'git-bash', detectedIds: ['pwsh', 'cmd'] })
    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.recipe.id).toBe('pwsh')
      expect(decision.warning).toBe('saved-terminal-missing')
      expect(decision.missing).toBe('git-bash')
    }
  })

  it('lets a body id win over the saved value', () => {
    const decision = resolve({ saved: 'wt-pwsh', bodyTerminalId: 'cmd' })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.recipe.id).toBe('cmd')
  })

  it('rejects a body id that is not in the registry', () => {
    for (const bad of ['__proto__', 'constructor', 'wt-pwsh --profile evil', 'cmd; calc.exe', 'C:\\evil.exe']) {
      expect(resolve({ bodyTerminalId: bad })).toEqual({
        ok: false,
        status: 400,
        error: 'Unknown terminal',
      })
    }
  })

  it('rejects a body id from another platform', () => {
    expect(resolve({ bodyTerminalId: 'iterm2' })).toEqual({
      ok: false,
      status: 400,
      error: 'Terminal not available on this platform',
    })
  })

  it('rejects a body id that is not installed', () => {
    expect(resolve({ bodyTerminalId: 'git-bash', detectedIds: ['pwsh'] })).toEqual({
      ok: false,
      status: 400,
      error: 'Terminal is not installed',
    })
  })

  it('503s when nothing is detected, even with a preference saved', () => {
    expect(resolve({ saved: 'wt-pwsh', detectedIds: [] })).toEqual({
      ok: false,
      status: 503,
      error: 'No supported terminal found',
    })
    expect(resolve({ saved: 'auto', detectedIds: [] })).toEqual({
      ok: false,
      status: 503,
      error: 'No supported terminal found',
    })
  })
})

describe('readTerminalPreferenceSync', () => {
  const written: string[] = []

  function writeSettings(contents: unknown): string {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rewind-pref-')),
      'settings.json',
    )
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents))
    written.push(file)
    return file
  }

  afterEach(() => {
    for (const file of written.splice(0)) {
      try {
        fs.rmSync(path.dirname(file), { recursive: true, force: true })
      } catch {
        // Best effort temp cleanup.
      }
    }
  })

  it('reads an exact registry id', () => {
    const file = writeSettings({ terminalProfiles: { win32: 'git-bash' } })
    expect(readTerminalPreferenceSync('win32', file)).toBe('git-bash')
  })

  it("reads the literal 'auto'", () => {
    const file = writeSettings({ terminalProfiles: { win32: 'auto' } })
    expect(readTerminalPreferenceSync('win32', file)).toBe('auto')
  })

  it('ignores a value saved under a different platform key', () => {
    const file = writeSettings({ terminalProfiles: { darwin: 'iterm2' } })
    expect(readTerminalPreferenceSync('win32', file)).toBeUndefined()
    expect(readTerminalPreferenceSync('darwin', file)).toBe('iterm2')
  })

  it('degrades a hostile value to absent, which asks rather than spawns', () => {
    for (const hostile of [
      'C:\\Users\\Public\\evil.exe',
      'cmd; calc.exe',
      'pwsh --command evil',
      '__proto__',
      'constructor',
      '',
      42,
      { id: 'cmd' },
    ]) {
      const file = writeSettings({ terminalProfiles: { win32: hostile } })
      expect(readTerminalPreferenceSync('win32', file)).toBeUndefined()
    }
  })

  it('returns undefined for a missing, unreadable or unparseable file', () => {
    expect(readTerminalPreferenceSync('win32', path.join(os.tmpdir(), 'no-such-settings.json'))).toBeUndefined()
    expect(readTerminalPreferenceSync('win32', writeSettings('{ not json'))).toBeUndefined()
    expect(readTerminalPreferenceSync('win32', writeSettings({ version: 1 }))).toBeUndefined()
  })

  it('does not resolve an inherited property as a preference', () => {
    const file = writeSettings('{"terminalProfiles":{"__proto__":{"win32":"cmd"}}}')
    expect(readTerminalPreferenceSync('win32', file)).toBeUndefined()
  })
})
