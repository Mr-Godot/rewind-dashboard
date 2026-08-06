import * as fs from 'node:fs'
import * as path from 'node:path'
import { getDashboardDir } from '../utils/claude-path'
import { AUTO_ORDER, getRecipe, type LaunchRecipe } from './terminal-registry'
import type { TerminalChoice, TerminalPlatform } from './terminal-ids'

/**
 * Turns "what the user saved" plus "what is installed" into a launch recipe,
 * or into a refusal. The one rule that matters: with no saved preference the
 * answer is 428, never a guess. Even a hand-crafted request cannot obtain a
 * silently defaulted spawn.
 *
 * Imported relatively (not via `@/`) because the Vite config bundles this
 * module through `esbuild`, which does not apply the tsconfig path alias.
 */

export type TerminalDecision =
  | {
      ok: true
      recipe: LaunchRecipe
      warning?: 'saved-terminal-missing'
      missing?: string
    }
  | { ok: false; status: 400 | 428 | 503; error: string }

export interface ResolveInput {
  /** Optional one-shot override from the POST body. Untrusted. */
  bodyTerminalId?: unknown
  /** The stored preference for this platform: undefined, 'auto', or an ID. */
  saved: TerminalChoice | undefined
  detectedIds: string[]
  platform: TerminalPlatform
}

function autoRecipe(input: ResolveInput): LaunchRecipe | null {
  const detected = new Set(input.detectedIds)
  const id = AUTO_ORDER[input.platform].find((candidate) => detected.has(candidate))
  return id ? (getRecipe(id) ?? null) : null
}

export function resolveRecipe(input: ResolveInput): TerminalDecision {
  const { bodyTerminalId, saved, detectedIds, platform } = input

  if (bodyTerminalId != null) {
    const recipe = getRecipe(bodyTerminalId)
    if (!recipe) {
      return { ok: false, status: 400, error: 'Unknown terminal' }
    }
    if (recipe.platform !== platform) {
      return { ok: false, status: 400, error: 'Terminal not available on this platform' }
    }
    if (!detectedIds.includes(recipe.id)) {
      return { ok: false, status: 400, error: 'Terminal is not installed' }
    }
    return { ok: true, recipe }
  }

  if (detectedIds.length === 0) {
    return { ok: false, status: 503, error: 'No supported terminal found' }
  }

  if (saved === undefined) {
    return { ok: false, status: 428, error: 'No terminal chosen' }
  }

  if (saved !== 'auto') {
    const recipe = getRecipe(saved)
    if (recipe && recipe.platform === platform && detectedIds.includes(recipe.id)) {
      return { ok: true, recipe }
    }
    // Uninstalled since it was chosen: still launch, but say so.
    const fallback = autoRecipe(input)
    if (!fallback) return { ok: false, status: 503, error: 'No supported terminal found' }
    return { ok: true, recipe: fallback, warning: 'saved-terminal-missing', missing: String(saved) }
  }

  const fallback = autoRecipe(input)
  if (!fallback) return { ok: false, status: 503, error: 'No supported terminal found' }
  return { ok: true, recipe: fallback }
}

/**
 * Read the saved choice straight off disk on every launch. A cache here would
 * miss the write that the first-run dialog just made, which is exactly the bug
 * this feature exists to avoid.
 *
 * Anything that is not the literal 'auto' or an exact registry key degrades to
 * undefined, which means "ask the user" rather than "spawn something".
 */
export function readTerminalPreferenceSync(
  platform: TerminalPlatform,
  settingsPath = path.join(getDashboardDir(), 'settings.json'),
): TerminalChoice | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined

  const profiles = (parsed as Record<string, unknown>).terminalProfiles
  if (typeof profiles !== 'object' || profiles === null) return undefined
  if (!Object.prototype.hasOwnProperty.call(profiles, platform)) return undefined

  const value = (profiles as Record<string, unknown>)[platform]
  if (value === 'auto') return 'auto'
  const recipe = getRecipe(value)
  return recipe ? recipe.id : undefined
}
