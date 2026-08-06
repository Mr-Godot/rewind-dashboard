import { useEffect, useRef } from 'react'
import { TERMINAL_LABELS, type TerminalChoice, type TerminalProfileId } from '@/lib/launch/terminal-ids'
import type { TerminalOption } from '@/features/terminal/TerminalSelector'

interface LaunchTerminalMenuProps {
  detected: TerminalOption[]
  /** undefined means no default has been chosen yet. */
  saved: TerminalChoice | undefined
  autoResolvedId: TerminalProfileId | null
  onLaunchWith: (id: TerminalProfileId) => void
  onPin: (id: TerminalProfileId) => void
  onClose: () => void
}

/**
 * The per-launch escape hatch. Once a default exists a row click launches once
 * and leaves the default alone, so the escape hatch is never destructive. With
 * no default set, an explicit pick from a list is a complete answer to the
 * first-run question, so it launches and becomes the default.
 */
export function LaunchTerminalMenu({
  detected,
  saved,
  autoResolvedId,
  onLaunchWith,
  onPin,
  onClose,
}: LaunchTerminalMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  const detectedIds = new Set(detected.map((d) => d.id))
  const isStale = saved !== undefined && saved !== 'auto' && !detectedIds.has(saved)
  const defaultId = saved === 'auto' ? autoResolvedId : isStale ? null : (saved ?? null)

  const header = isStale
    ? `Launch with (default ${TERMINAL_LABELS[saved as TerminalProfileId]} is not installed)`
    : saved === undefined
      ? 'Launch with (no default set)'
      : 'Launch with'

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-gray-800 bg-gray-950 shadow-lg"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className={`px-3 py-2 text-[10px] ${isStale ? 'text-amber-400' : 'text-gray-500'}`}>
        {header}
      </div>
      <div className="border-t border-gray-800" />
      <ul className="py-1">
        {detected.map((option) => (
          <li key={option.id} className="group flex items-center justify-between">
            <button
              type="button"
              role="menuitem"
              onClick={() => onLaunchWith(option.id)}
              className={`flex-1 px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-900 ${
                defaultId === option.id ? 'text-matrix' : 'text-gray-300'
              }`}
            >
              {option.label}
              {defaultId === option.id && <span className="ml-1 text-[10px]">(default)</span>}
            </button>
            <button
              type="button"
              aria-label={`Set ${option.label} as the default`}
              title="Set as default"
              onClick={() => onPin(option.id)}
              className="mr-2 hidden px-1 text-[10px] text-gray-500 transition-colors hover:text-gray-300 group-hover:block"
            >
              pin
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-800" />
      <div className="px-3 py-2 text-[10px] text-gray-600">Change the default in Settings</div>
    </div>
  )
}
