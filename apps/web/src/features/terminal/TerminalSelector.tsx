import { TERMINAL_LABELS, type TerminalChoice, type TerminalProfileId } from '@/lib/launch/terminal-ids'

export interface TerminalOption {
  id: TerminalProfileId
  label: string
}

interface TerminalSelectorProps {
  detected: TerminalOption[]
  /** What 'auto' currently resolves to, used for the recommended tag. */
  autoResolvedId: TerminalProfileId | null
  /** undefined means the user has never chosen on this platform. */
  value: TerminalChoice | undefined
  onChange: (choice: TerminalChoice) => void
  /** Tag the auto-resolved row, even once it is preselected. */
  showRecommended?: boolean
  /** Distinguishes the radio group when both the dialog and Settings mount. */
  name?: string
}

/**
 * The radio group shared by the Settings card and the first-run dialog. Lists
 * only detected terminals, plus Automatic, plus a saved-but-missing row so a
 * deliberate choice is never silently deselected.
 */
export function TerminalSelector({
  detected,
  autoResolvedId,
  value,
  onChange,
  showRecommended = false,
  name = 'terminal-profile',
}: TerminalSelectorProps) {
  const detectedIds = new Set(detected.map((d) => d.id))
  const staleId =
    value && value !== 'auto' && !detectedIds.has(value) ? (value as TerminalProfileId) : null
  const autoLabel = autoResolvedId ? TERMINAL_LABELS[autoResolvedId] : 'nothing available'
  const selected = value ?? null

  return (
    <div role="radiogroup" aria-label="Terminal" className="space-y-1">
      {staleId && (
        <Row
          name={name}
          id={staleId}
          checked
          onSelect={() => onChange(staleId)}
          label={TERMINAL_LABELS[staleId]}
          note="not installed, using Automatic"
          noteClass="text-amber-400"
        />
      )}

      {detected.map((option) => (
        <Row
          key={option.id}
          name={name}
          id={option.id}
          checked={selected === option.id}
          onSelect={() => onChange(option.id)}
          label={option.label}
          note={
            (showRecommended || value === undefined) && autoResolvedId === option.id
              ? 'recommended'
              : undefined
          }
          noteClass="text-gray-500"
        />
      ))}

      <Row
        name={name}
        id="auto"
        checked={selected === 'auto'}
        onSelect={() => onChange('auto')}
        label="Automatic"
        description="Let Rewind pick the best available terminal each time"
        note={`currently: ${autoLabel}`}
        noteClass="text-gray-500"
      />
    </div>
  )
}

function Row({
  name,
  id,
  checked,
  onSelect,
  label,
  description,
  note,
  noteClass,
}: {
  name: string
  id: string
  checked: boolean
  onSelect: () => void
  label: string
  description?: string
  note?: string
  noteClass?: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-900">
      <span className="flex items-start gap-2">
        <input
          type="radio"
          name={name}
          value={id}
          checked={checked}
          onChange={onSelect}
          className="mt-0.5 h-3 w-3 accent-brand-600"
        />
        <span>
          <span className="block text-xs text-gray-300">{label}</span>
          {description && <span className="block text-[10px] text-gray-500">{description}</span>}
        </span>
      </span>
      {note && <span className={`shrink-0 text-[10px] ${noteClass ?? 'text-gray-500'}`}>{note}</span>}
    </label>
  )
}
