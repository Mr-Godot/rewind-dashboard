import { z } from 'zod'
import {
  TERMINAL_PROFILE_IDS,
  type TerminalChoice,
  type TerminalPlatform,
} from '@/lib/launch/terminal-ids'

// --- Zod Schemas ---

export const TerminalProfileIdSchema = z.enum(TERMINAL_PROFILE_IDS)

/** A stored answer is either a profile, or the literal 'auto'. Absent is neither. */
export const TerminalChoiceSchema = z.union([TerminalProfileIdSchema, z.literal('auto')])

/**
 * Keyed by platform so a settings.json synced between machines never has one
 * OS overwrite another's answer. `.catch(undefined)` is per key on purpose: one
 * corrupt key degrades to "never chose" (which asks the user) while the other
 * platforms' answers survive.
 */
export const TerminalProfilesSchema = z
  .object({
    win32: TerminalChoiceSchema.optional().catch(undefined),
    darwin: TerminalChoiceSchema.optional().catch(undefined),
    linux: TerminalChoiceSchema.optional().catch(undefined),
  })
  .default({})

export const ModelPricingOverrideSchema = z.object({
  inputPerMTok: z.number().min(0),
  outputPerMTok: z.number().min(0),
  cacheReadPerMTok: z.number().min(0),
  cacheWritePerMTok: z.number().min(0),
})

export const SettingsSchema = z.object({
  version: z.literal(1),
  subscriptionTier: z
    .enum(['free', 'pro', 'max-5x', 'max-20x', 'teams', 'enterprise', 'api'])
    .default('pro'),
  pricingOverrides: z
    .record(z.string(), ModelPricingOverrideSchema)
    .default({}),
  terminalProfiles: TerminalProfilesSchema,
  updatedAt: z.string().datetime().optional(),
})

/**
 * The write path, without the per-key `.catch`. Coercion belongs only on the
 * read path, where the alternative is discarding the user's whole settings
 * file. A save carrying a bogus profile ID is rejected loudly instead.
 */
export const SettingsWriteSchema = SettingsSchema.extend({
  terminalProfiles: z
    .object({
      win32: TerminalChoiceSchema.optional(),
      darwin: TerminalChoiceSchema.optional(),
      linux: TerminalChoiceSchema.optional(),
    })
    .default({}),
})

// --- TypeScript Types ---

export type ModelPricingOverride = z.infer<typeof ModelPricingOverrideSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type SubscriptionTierId = Settings['subscriptionTier']
export type TerminalProfiles = z.infer<typeof TerminalProfilesSchema>

export interface ModelPricing {
  modelId: string
  displayName: string
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
}

export interface SubscriptionTier {
  id: SubscriptionTierId
  displayName: string
  monthlyUSD: number | null
}

// --- Constants ---

export const DEFAULT_PRICING: ModelPricing[] = [
  {
    modelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  {
    modelId: 'claude-opus-4-5',
    displayName: 'Claude Opus 4.5',
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  {
    modelId: 'claude-opus-4-1',
    displayName: 'Claude Opus 4.1',
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheWritePerMTok: 18.75,
  },
  {
    modelId: 'claude-opus-4',
    displayName: 'Claude Opus 4',
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    cacheReadPerMTok: 1.5,
    cacheWritePerMTok: 18.75,
  },
  {
    modelId: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  {
    modelId: 'claude-sonnet-4',
    displayName: 'Claude Sonnet 4',
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
  },
  {
    modelId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
  },
  {
    modelId: 'claude-haiku-3-5',
    displayName: 'Claude Haiku 3.5',
    inputPerMTok: 0.8,
    outputPerMTok: 4.0,
    cacheReadPerMTok: 0.08,
    cacheWritePerMTok: 1.0,
  },
  {
    modelId: 'claude-haiku-3',
    displayName: 'Claude Haiku 3',
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    cacheReadPerMTok: 0.03,
    cacheWritePerMTok: 0.3,
  },
]

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  { id: 'free', displayName: 'Free', monthlyUSD: 0 },
  { id: 'pro', displayName: 'Pro', monthlyUSD: 20 },
  { id: 'max-5x', displayName: 'Max 5x', monthlyUSD: 100 },
  { id: 'max-20x', displayName: 'Max 20x', monthlyUSD: 200 },
  { id: 'teams', displayName: 'Teams', monthlyUSD: 150 },
  { id: 'enterprise', displayName: 'Enterprise', monthlyUSD: null },
  { id: 'api', displayName: 'API Only', monthlyUSD: null },
]

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  subscriptionTier: 'pro',
  pricingOverrides: {},
  terminalProfiles: {},
}

// --- Helpers ---

/**
 * Merge a pending terminal edit into the stored per-platform map. An edit whose
 * value is `undefined` deletes the platform key, which is the only route back to
 * the "never chose" state that re-arms the first-run prompt.
 */
export function buildTerminalProfiles(
  settings: Settings,
  platform: TerminalPlatform | undefined,
  edit: { value: TerminalChoice | undefined } | null,
): TerminalProfiles {
  const profiles: TerminalProfiles = { ...settings.terminalProfiles }
  if (!platform || !edit) return profiles
  if (edit.value === undefined) delete profiles[platform]
  else profiles[platform] = edit.value
  return profiles
}

/** Strip date suffix from model IDs: claude-sonnet-4-20250514 -> claude-sonnet-4 */
export function normalizeModelId(raw: string): string {
  return raw.replace(/-\d{8}$/, '')
}
