import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsQuery, useSettingsMutation } from './settings.queries'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SubscriptionTierId,
  buildTerminalProfiles,
  type ModelPricingOverride,
} from './settings.types'
import { TierSelector } from './TierSelector'
import { PricingTableEditor } from './PricingTableEditor'
import { usePrivacy } from '@/features/privacy/PrivacyContext'
import { useTheme } from '@/features/theme/ThemeProvider'
import { useRescan } from '@/features/sessions/rescan.queries'
import { TerminalSelector } from '@/features/terminal/TerminalSelector'
import { terminalsQuery, useRedetectTerminals } from '@/features/terminal/terminal.queries'
import type { TerminalChoice } from '@/lib/launch/terminal-ids'

export function SettingsPage() {
  const { data: settings, isLoading } = useQuery(settingsQuery)

  if (isLoading || !settings) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-900/50" />
      </div>
    )
  }

  return <SettingsForm settings={settings} />
}

function RedetectButton({ onClick, isPending }: { onClick: () => void; isPending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? 'detecting…' : 're-detect'}
    </button>
  )
}

function SettingsForm({ settings }: { settings: Settings }) {
  const mutation = useSettingsMutation()
  const { privacyMode, togglePrivacyMode } = usePrivacy()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const rescan = useRescan()
  const { data: terminals } = useQuery(terminalsQuery)
  const redetect = useRedetectTerminals()
  const platform = terminals?.platform

  const [tier, setTier] = useState<SubscriptionTierId>(settings.subscriptionTier)
  const [overrides, setOverrides] = useState<Record<string, ModelPricingOverride>>(settings.pricingOverrides)
  // Boxed so that "the user cleared it" stays distinguishable from "the
  // detection query has not resolved yet", which is the same absent-vs-auto
  // distinction the whole feature turns on.
  const [terminalEdit, setTerminalEdit] = useState<{ value: TerminalChoice | undefined } | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const terminal = terminalEdit
    ? terminalEdit.value
    : platform
      ? settings.terminalProfiles[platform]
      : undefined

  function handleTerminalChange(choice: TerminalChoice) {
    setTerminalEdit({ value: choice })
    setIsDirty(true)
  }

  function handleAskAgain() {
    setTerminalEdit({ value: undefined })
    setIsDirty(true)
  }

  function handleTierChange(newTier: SubscriptionTierId) {
    setTier(newTier)
    setIsDirty(true)
  }

  function handleOverridesChange(newOverrides: Record<string, ModelPricingOverride>) {
    setOverrides(newOverrides)
    setIsDirty(true)
  }

  function handleReset() {
    setTier(DEFAULT_SETTINGS.subscriptionTier)
    setOverrides(DEFAULT_SETTINGS.pricingOverrides)
    // Reset writes 'auto', it does not delete the key: clearing pricing
    // overrides must not silently re-arm the first-run terminal prompt.
    setTerminalEdit({ value: 'auto' })
    setIsDirty(true)
  }

  function handleSave() {
    // Spread first: any field not named below (terminalProfiles, updatedAt)
    // would otherwise be destroyed by an unrelated save.
    const updated: Settings = {
      ...settings,
      version: 1,
      subscriptionTier: tier,
      pricingOverrides: overrides,
      terminalProfiles: buildTerminalProfiles(settings, platform, terminalEdit),
    }
    mutation.mutate(updated, {
      onSuccess: () => {
        setIsDirty(false)
        setTerminalEdit(null)
      },
    })
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-100">Settings</h1>
      <p className="mt-1 text-xs text-gray-500">
        Configure your subscription tier and API pricing for cost estimation.
      </p>

      {/* Privacy Mode */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-300">Privacy Mode</h2>
        <p className="mt-1 text-[10px] text-gray-500">
          Hide project names, file paths, and branch names across the dashboard.
          Useful when screen-sharing or recording demos.
        </p>
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-300">Enable privacy mode</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {privacyMode ? 'On' : 'Off'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={privacyMode}
                onClick={togglePrivacyMode}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  privacyMode ? 'bg-brand-600' : 'bg-gray-800'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    privacyMode ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>
          </div>
          <div className="mt-3 border-t border-gray-800 pt-3">
            <p className="text-[10px] font-medium text-gray-400">
              What gets hidden:
            </p>
            <ul className="mt-1.5 space-y-1 text-[10px] text-gray-500">
              <li>
                <span className="text-gray-400">Project names</span>{' '}
                <span className="font-mono text-gray-600">
                  &rarr; project-1, project-2, ...
                </span>
              </li>
              <li>
                <span className="text-gray-400">File paths</span>{' '}
                <span className="font-mono text-gray-600">
                  &rarr; .../project-1
                </span>
              </li>
              <li>
                <span className="text-gray-400">Branch names</span>{' '}
                <span className="font-mono text-gray-600">
                  &rarr; branch-1, branch-2, ...
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-300">Theme</h2>
        <p className="mt-1 text-[10px] text-gray-500">
          Switch between dark and light mode. Defaults to your system preference.
        </p>
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-300">
              {isDark ? 'Dark mode' : 'Light mode'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {isDark ? '🌙' : '☀️'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={!isDark}
                onClick={toggleTheme}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                  !isDark ? 'bg-brand-600' : 'bg-gray-800'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    !isDark ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Maintenance */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-300">Maintenance</h2>
        <p className="mt-1 text-[10px] text-gray-500">
          Force a cold re-scan of ~/.claude. Use this to pick up new sessions or
          un-stick sessions that look stuck.
        </p>
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-300">Re-scan sessions</span>
            <div className="flex items-center gap-2">
              {rescan.isSuccess && (
                <span className="text-xs text-matrix">done</span>
              )}
              <button
                type="button"
                onClick={() => rescan.mutate()}
                disabled={rescan.isPending}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rescan.isPending ? 'rescanning…' : 'rescan'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-300">Terminal</h2>
        <p className="mt-1 text-[10px] text-gray-500">
          Choose which terminal the Launch button opens. Only terminals detected on this
          machine are listed.
        </p>
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          {!terminals ? (
            <div className="h-20 animate-pulse rounded bg-gray-800/50" />
          ) : terminals.detected.length === 0 ? (
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-gray-400">
                No supported terminal was detected on this machine. Launch is unavailable.
                Install Windows Terminal or PowerShell 7, then re-detect.
              </p>
              <RedetectButton
                onClick={() => redetect.mutate()}
                isPending={redetect.isPending}
              />
            </div>
          ) : (
            <>
              {terminal === undefined && (
                <p className="mb-3 text-[11px] text-gray-400">
                  You have not chosen a terminal yet. Rewind will ask the first time you
                  launch a session, or you can choose now.
                </p>
              )}
              <TerminalSelector
                name="settings-terminal"
                detected={terminals.detected}
                autoResolvedId={terminals.autoResolvedId}
                value={terminal}
                onChange={handleTerminalChange}
              />
              <div className="mt-3 flex items-center justify-between border-t border-gray-800 pt-3">
                <span className="text-[10px] text-gray-500">
                  {terminals.detected.length} detected
                </span>
                <div className="flex items-center gap-3">
                  {terminal !== undefined && (
                    <button
                      type="button"
                      onClick={handleAskAgain}
                      className="text-[10px] text-gray-500 transition-colors hover:text-gray-300"
                    >
                      ask me again next launch
                    </button>
                  )}
                  <RedetectButton
                    onClick={() => redetect.mutate()}
                    isPending={redetect.isPending}
                  />
                </div>
              </div>
              {terminalEdit?.value === undefined && terminalEdit !== null && (
                <p className="mt-2 text-[10px] text-gray-500">
                  The terminal prompt will show on your next launch. Save to confirm.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Subscription Tier */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-300">Subscription Tier</h2>
        <p className="mt-1 text-[10px] text-gray-500">
          Select your Claude subscription plan. This is informational only and does not
          affect cost calculations.
        </p>
        <div className="mt-3">
          <TierSelector value={tier} onChange={handleTierChange} />
        </div>
      </div>

      {/* Pricing Table */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-gray-300">
          API Pricing (per million tokens)
        </h2>
        <p className="mt-1 text-[10px] text-gray-500">
          Default prices from Anthropic. Override any value to match your negotiated
          rates.
        </p>
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <PricingTableEditor
            overrides={overrides}
            onChange={handleOverridesChange}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300"
        >
          Reset to Defaults
        </button>

        <div className="flex items-center gap-3">
          {mutation.isSuccess && !isDirty && (
            <span className="text-xs text-matrix">Saved</span>
          )}
          {mutation.isError && (
            <span className="text-xs text-red-400">
              Failed to save: {mutation.error?.message ?? 'Unknown error'}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || mutation.isPending}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              isDirty && !mutation.isPending
                ? 'bg-brand-600 text-gray-100 hover:bg-brand-500'
                : 'cursor-not-allowed bg-gray-800 text-gray-500'
            }`}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
