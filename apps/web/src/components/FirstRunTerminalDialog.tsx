import { useEffect, useState } from 'react'
import { TerminalSelector, type TerminalOption } from '@/features/terminal/TerminalSelector'
import type { TerminalChoice, TerminalProfileId } from '@/lib/launch/terminal-ids'

interface FirstRunTerminalDialogProps {
  detected: TerminalOption[]
  autoResolvedId: TerminalProfileId | null
  /** Saves the choice and then launches, in that order. */
  onConfirm: (choice: TerminalChoice) => void
  /** Not now, x, Escape and backdrop all land here: nothing is saved or launched. */
  onDismiss: () => void
  isSaving?: boolean
}

/**
 * Asked once, on the first click of Launch. Dismissing cancels the launch
 * rather than picking a terminal on the user's behalf, which is the whole point
 * of the feature. Automatic is the permanent one-click answer.
 */
export function FirstRunTerminalDialog({
  detected,
  autoResolvedId,
  onConfirm,
  onDismiss,
  isSaving,
}: FirstRunTerminalDialogProps) {
  const [choice, setChoice] = useState<TerminalChoice | undefined>(autoResolvedId ?? undefined)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onDismiss])

  if (detected.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="first-run-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose your terminal"
        className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-950 p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-sm font-semibold text-gray-100">Choose your terminal</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onDismiss}
            className="text-gray-500 transition-colors hover:text-gray-300"
          >
            &times;
          </button>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Rewind opens a real terminal window to resume a session. Which one should it use?
          Only terminals found on this machine are listed.
        </p>

        <div className="mt-4">
          <TerminalSelector
            name="first-run-terminal"
            detected={detected}
            autoResolvedId={autoResolvedId}
            showRecommended
            value={choice}
            onChange={setChoice}
          />
        </div>

        <p className="mt-4 text-[10px] text-gray-600">You can change this any time in Settings.</p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-300"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={!choice || isSaving}
            onClick={() => choice && onConfirm(choice)}
            className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
              choice && !isSaving
                ? 'bg-brand-600 text-gray-100 hover:bg-brand-500'
                : 'cursor-not-allowed bg-gray-800 text-gray-500'
            }`}
          >
            {isSaving ? 'Saving...' : 'Use this terminal'}
          </button>
        </div>
      </div>
    </div>
  )
}
