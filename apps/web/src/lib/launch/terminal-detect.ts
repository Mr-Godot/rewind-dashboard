import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { AUTO_ORDER, listRecipes, type LaunchRecipe } from './terminal-registry'
import { TERMINAL_LABELS, type TerminalPlatform, type TerminalProfileId } from './terminal-ids'

/**
 * Probes which terminals are actually installed. Runs server side only, is
 * cached for the life of the process, and never throws: a probe that fails
 * yields "not detected" for that one profile.
 */

export interface DetectedTerminal {
  id: TerminalProfileId
  label: string
}

export interface DetectionResult {
  platform: TerminalPlatform
  detected: DetectedTerminal[]
  /** What 'auto' currently resolves to, or null when nothing is detected. */
  autoResolvedId: TerminalProfileId | null
}

/** true, or the absolute launcher path for `file` probes. */
export type ProbeOutcome = boolean | string

export interface DetectOptions {
  force?: boolean
  platform?: TerminalPlatform
  probe?: (recipe: LaunchRecipe) => ProbeOutcome
}

function currentPlatform(): TerminalPlatform {
  const p = process.platform
  if (p === 'win32' || p === 'darwin') return p
  return 'linux'
}

/** Walk the PATH environment variable. Zero subprocesses, so nothing to escape. */
function existsOnPath(exe: string): boolean {
  const raw = process.env.PATH
  if (!raw) return false
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of raw.split(sep)) {
    if (!dir) continue
    try {
      if (fs.existsSync(path.join(dir, exe))) return true
    } catch {
      // Unreadable PATH entry: keep walking.
    }
  }
  return false
}

/**
 * On Windows `wt.exe` is an App Execution Alias, a zero-byte reparse point that
 * `fs.existsSync` reports inconsistently, so `where.exe` is the only reliable
 * probe. `execFileSync` with an argv array runs no shell.
 */
function resolvesOnWindowsPath(exe: string): boolean {
  try {
    execFileSync('where.exe', [exe], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** `C:\Program Files\Git\cmd\git.exe` -> `C:\Program Files\Git\usr\bin\mintty.exe` */
function minttyViaGit(): string | null {
  try {
    const out = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' })
    const first = out.split(/\r?\n/).find((l) => l.trim())
    if (!first) return null
    const candidate = path.join(path.dirname(path.dirname(first.trim())), 'usr', 'bin', 'mintty.exe')
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

function defaultProbe(recipe: LaunchRecipe): ProbeOutcome {
  switch (recipe.probe.kind) {
    case 'always':
      return true
    case 'path': {
      const check = process.platform === 'win32' ? resolvesOnWindowsPath : existsOnPath
      return recipe.probe.exes.every((exe) => check(exe))
    }
    case 'file': {
      for (const candidate of recipe.probe.candidates()) {
        try {
          if (fs.existsSync(candidate)) return candidate
        } catch {
          // Unreadable candidate: try the next.
        }
      }
      return recipe.id === 'git-bash' ? (minttyViaGit() ?? false) : false
    }
  }
}

let cache: DetectionResult | null = null
let launcherPaths = new Map<string, string>()

export function clearDetectionCache(): void {
  cache = null
  launcherPaths = new Map()
}

/** Absolute launcher path discovered by a `file` probe. Memory only, never persisted. */
export function getResolvedLauncher(id: string): string | undefined {
  return launcherPaths.get(id)
}

export function detectTerminalsSync(options: DetectOptions = {}): DetectionResult {
  if (options.force) clearDetectionCache()
  if (cache) return cache

  const platform = options.platform ?? currentPlatform()
  const probe = options.probe ?? defaultProbe
  const detected: DetectedTerminal[] = []
  const paths = new Map<string, string>()

  for (const recipe of listRecipes(platform)) {
    let outcome: ProbeOutcome = false
    try {
      outcome = probe(recipe)
    } catch {
      // A throwing probe means "not detected", never a failed detection run.
      outcome = false
    }
    if (!outcome) continue
    if (typeof outcome === 'string') paths.set(recipe.id, outcome)
    detected.push({ id: recipe.id, label: TERMINAL_LABELS[recipe.id] })
  }

  const detectedIds = new Set(detected.map((d) => d.id))
  const autoResolvedId = AUTO_ORDER[platform].find((id) => detectedIds.has(id)) ?? null

  launcherPaths = paths
  cache = { platform, detected, autoResolvedId }
  return cache
}
