import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsQuery, useSettingsMutation } from '@/features/settings/settings.queries'
import { terminalsQuery } from '@/features/terminal/terminal.queries'
import type { TerminalChoice, TerminalProfileId } from '@/lib/launch/terminal-ids'
import { FirstRunTerminalDialog } from './FirstRunTerminalDialog'
import { LaunchTerminalMenu } from './LaunchTerminalMenu'

interface LaunchButtonProps {
  sessionId: string
  cwd?: string
  size?: 'sm' | 'md'
  isActive?: boolean
}

export function LaunchButton({ sessionId, cwd, size = 'sm', isActive }: LaunchButtonProps) {
  const [status, setStatus] = useState<'idle' | 'launched' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const padding = size === 'md' ? 'px-3 py-1' : 'px-2 py-0.5'

  const { data: terminals } = useQuery(terminalsQuery)
  const { data: settings } = useQuery(settingsQuery)
  const settingsMutation = useSettingsMutation()

  const detected = terminals?.detected ?? []
  const platform = terminals?.platform
  const saved: TerminalChoice | undefined = platform
    ? settings?.terminalProfiles?.[platform]
    : undefined
  const noTerminals = terminals !== undefined && detected.length === 0

  const launch = useCallback(
    async (terminalId?: TerminalProfileId) => {
      try {
        const res = await fetch('/api/launch-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(terminalId ? { sessionId, cwd, terminalId } : { sessionId, cwd }),
        })
        if (res.ok) {
          setError(null)
          setStatus('launched')
          setTimeout(() => setStatus('idle'), 2000)
          return
        }
        // The server refused (e.g. 409: the recorded working directory is gone).
        // Show its reason instead of a silent no-op.
        const body = await res.json().catch(() => null)
        setError(body?.error ?? `Launch failed (${res.status})`)
        setStatus('error')
        setTimeout(() => setStatus('idle'), 8000)
      } catch {
        setError('Launch failed: the dashboard server did not respond')
        setStatus('error')
        setTimeout(() => setStatus('idle'), 8000)
      }
    },
    [sessionId, cwd],
  )

  /** Persist the choice without disturbing the rest of settings. */
  const saveChoice = useCallback(
    async (choice: TerminalChoice) => {
      if (!settings || !platform) return
      await settingsMutation.mutateAsync({
        ...settings,
        terminalProfiles: { ...settings.terminalProfiles, [platform]: choice },
      })
    },
    [settings, platform, settingsMutation],
  )

  const handleLaunchClick = useCallback(() => {
    if (noTerminals) return
    // Absent means the user has never chosen on this platform: ask, do not guess.
    if (terminals !== undefined && settings !== undefined && saved === undefined) {
      setShowMenu(false)
      setShowDialog(true)
      return
    }
    void launch()
  }, [noTerminals, terminals, settings, saved, launch])

  const handleConfirm = useCallback(
    async (choice: TerminalChoice) => {
      try {
        // The spawn re-reads settings.json, so the write MUST land first.
        await saveChoice(choice)
        setShowDialog(false)
        await launch()
      } catch {
        setShowDialog(false)
        setError('Could not save your terminal choice')
        setStatus('error')
        setTimeout(() => setStatus('idle'), 8000)
      }
    },
    [saveChoice, launch],
  )

  const handleMenuLaunch = useCallback(
    async (id: TerminalProfileId) => {
      setShowMenu(false)
      try {
        // An explicit pick from a list is a complete answer to the first-run
        // question, so it also becomes the default when none is set yet.
        if (saved === undefined) await saveChoice(id)
        await launch(id)
      } catch {
        setError('Could not save your terminal choice')
        setStatus('error')
        setTimeout(() => setStatus('idle'), 8000)
      }
    },
    [saved, saveChoice, launch],
  )

  const handlePin = useCallback(
    async (id: TerminalProfileId) => {
      setShowMenu(false)
      try {
        await saveChoice(id)
      } catch {
        setError('Could not save your terminal choice')
        setStatus('error')
        setTimeout(() => setStatus('idle'), 8000)
      }
    },
    [saveChoice],
  )

  if (isActive) {
    return (
      <span className={`shrink-0 border border-matrix/20 bg-matrix/10 ${padding} text-xs font-medium text-matrix/60`}>
        active
      </span>
    )
  }

  const disabledTooltip = 'No supported terminal detected. See Settings.'

  return (
    <>
      <span className="relative inline-flex items-stretch">
        <button
          type="button"
          disabled={noTerminals}
          title={
            noTerminals
              ? disabledTooltip
              : status === 'error' && error
                ? error
                : 'Launch session in terminal'
          }
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleLaunchClick()
          }}
          className={`shrink-0 border border-matrix/20 bg-matrix/10 ${padding} text-xs font-medium text-matrix transition-colors hover:border-matrix/30 hover:bg-matrix/15 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {status === 'launched' ? 'Launched!' : status === 'error' ? 'Failed' : 'Launch'}
        </button>
        {detected.length >= 2 && (
          <button
            type="button"
            aria-label="Choose terminal"
            title="Choose terminal"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowMenu((open) => !open)
            }}
            className={`shrink-0 border border-l-0 border-matrix/20 bg-matrix/10 ${padding} text-xs font-medium text-matrix/50 transition-colors hover:border-matrix/30 hover:text-matrix`}
          >
            &#9881;
          </button>
        )}
        {showMenu && platform && (
          <LaunchTerminalMenu
            detected={detected}
            saved={saved}
            autoResolvedId={terminals?.autoResolvedId ?? null}
            onLaunchWith={(id) => void handleMenuLaunch(id)}
            onPin={(id) => void handlePin(id)}
            onClose={() => setShowMenu(false)}
          />
        )}
      </span>
      {status === 'error' && error && (
        <span role="alert" title={error} className="max-w-64 truncate text-[10px] text-red-400">
          {error}
        </span>
      )}
      {showDialog && (
        <FirstRunTerminalDialog
          detected={detected}
          autoResolvedId={terminals?.autoResolvedId ?? null}
          isSaving={settingsMutation.isPending}
          onConfirm={(choice) => void handleConfirm(choice)}
          onDismiss={() => setShowDialog(false)}
        />
      )}
    </>
  )
}
