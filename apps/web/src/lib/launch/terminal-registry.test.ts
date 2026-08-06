import { describe, it, expect } from 'vitest'
import {
  AUTO_ORDER,
  buildScript,
  escapeShellSingleQuoted,
  getRecipe,
  listRecipes,
  registryIds,
  SCRIPT_EXTENSIONS,
  UnsupportedCwdError,
} from './terminal-registry'
import { TERMINAL_LABELS, TERMINAL_PROFILE_IDS } from './terminal-ids'
import { TerminalProfileIdSchema } from '@/features/settings/settings.types'

const HOSTILE_CWD = "C:\\Users\\a b\\o'brien & co 100%"
const SAFE_CWD = "C:\\Users\\a b\\o'brien & co"
const SESSION_ID = 'bb968dcf-5394-47a8-abc6-822ee9254871'

describe('registry shape', () => {
  it('has a unique id, a valid platform and a script flavor for every entry', () => {
    const ids = registryIds()
    expect(new Set(ids).size).toBe(ids.length)
    for (const recipe of listRecipes()) {
      expect(['win32', 'darwin', 'linux']).toContain(recipe.platform)
      expect(Object.keys(SCRIPT_EXTENSIONS)).toContain(recipe.scriptFlavor)
      expect(typeof recipe.argv).toBe('function')
    }
  })

  it('builds argv as an array of strings, with the cwd as a discrete element', () => {
    for (const recipe of listRecipes()) {
      const argv = recipe.argv({
        scriptPath: '/tmp/launch-session-bb968dcf.sh',
        sessionCwd: HOSTILE_CWD,
        windowTitle: 'Rewind Session bb968dcf',
        launcherPath: 'C:\\Program Files\\Git\\usr\\bin\\mintty.exe',
      })
      expect(Array.isArray(argv)).toBe(true)
      for (const arg of argv) expect(typeof arg).toBe('string')
      // Never a single concatenated command line.
      expect(argv.some((a) => a.includes('&&') || a.includes('| '))).toBe(false)
    }
  })

  it('has a label for every id', () => {
    for (const id of registryIds()) {
      expect(TERMINAL_LABELS[id as keyof typeof TERMINAL_LABELS]).toBeTruthy()
    }
  })

  it('lists an auto preference order containing only real ids for every platform', () => {
    for (const [platform, order] of Object.entries(AUTO_ORDER)) {
      for (const id of order) {
        const recipe = getRecipe(id)
        expect(recipe).toBeDefined()
        expect(recipe?.platform).toBe(platform)
      }
    }
  })
})

describe('registry lookup is exact membership only', () => {
  it('rejects prototype keys', () => {
    expect(getRecipe('__proto__')).toBeUndefined()
    expect(getRecipe('constructor')).toBeUndefined()
    expect(getRecipe('toString')).toBeUndefined()
    expect(getRecipe('hasOwnProperty')).toBeUndefined()
  })

  it('rejects empty, auto and non-strings', () => {
    expect(getRecipe('')).toBeUndefined()
    expect(getRecipe('auto')).toBeUndefined()
    expect(getRecipe(undefined)).toBeUndefined()
    expect(getRecipe(null)).toBeUndefined()
    expect(getRecipe(42)).toBeUndefined()
    expect(getRecipe(['wt-pwsh'])).toBeUndefined()
  })

  it('rejects a smuggled argument on a legitimate id', () => {
    expect(getRecipe('wt-pwsh --profile evil')).toBeUndefined()
    expect(getRecipe('cmd; calc.exe')).toBeUndefined()
    expect(getRecipe('cmd calc.exe')).toBeUndefined()
  })

  it('rejects an absolute path', () => {
    expect(getRecipe('C:\\Users\\Public\\evil.exe')).toBeUndefined()
    expect(getRecipe('/usr/bin/evil')).toBeUndefined()
  })

  it('does not normalise, case fold or trim', () => {
    expect(getRecipe(' wt-pwsh')).toBeUndefined()
    expect(getRecipe('wt-pwsh ')).toBeUndefined()
    expect(getRecipe('WT-PWSH')).toBeUndefined()
    expect(getRecipe('wt-pwsh\n')).toBeUndefined()
    expect(getRecipe('wt-pwsh')).toBeDefined()
  })
})

describe('enum and registry do not drift', () => {
  it('TerminalProfileIdSchema members exactly equal the registry keys', () => {
    expect([...registryIds()].sort()).toEqual([...TERMINAL_PROFILE_IDS].sort())
    expect([...TerminalProfileIdSchema.options].sort()).toEqual([...registryIds()].sort())
  })
})

describe('per-flavor quoting', () => {
  const ctx = { sessionId: SESSION_ID, sessionCwd: HOSTILE_CWD, windowTitle: 'Rewind Session bb968dcf' }

  it('ps1 doubles the apostrophe and leaves & and % alone', () => {
    const script = buildScript('ps1', ctx)
    expect(script).toContain(
      "Set-Location -LiteralPath 'C:\\Users\\a b\\o''brien & co 100%'",
    )
  })

  it('sh single-quotes the path and escapes the apostrophe', () => {
    const script = buildScript('sh', ctx)
    expect(script).toContain(`cd '${escapeShellSingleQuoted(HOSTILE_CWD)}'`)
    expect(script).toContain("cd 'C:\\Users\\a b\\o'\\''brien & co 100%'")
  })

  it('command single-quotes the path the same way', () => {
    const script = buildScript('command', ctx)
    expect(script).toContain("cd 'C:\\Users\\a b\\o'\\''brien & co 100%'")
  })

  it('bat refuses a percent sign rather than mangling it', () => {
    expect(() => buildScript('bat', ctx)).toThrow(UnsupportedCwdError)
  })

  it('bat quotes a path containing a space, an apostrophe and an ampersand', () => {
    const script = buildScript('bat', { ...ctx, sessionCwd: SAFE_CWD })
    expect(script).toContain(`cd /d "${SAFE_CWD}"`)
  })

  it('every flavor embeds the resume command and keeps the window open', () => {
    for (const flavor of ['ps1', 'sh', 'command', 'bat'] as const) {
      const script = buildScript(flavor, { ...ctx, sessionCwd: SAFE_CWD })
      expect(script).toContain(`claude --resume ${SESSION_ID} --dangerously-skip-permissions`)
    }
  })
})
