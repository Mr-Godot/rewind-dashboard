import type { ReactNode } from 'react'

/**
 * The one empty-state card. Gray tokens only, so it reads correctly in both
 * palettes: the gray ramp is the only thing app.css inverts for light mode.
 *
 * `title` sits at text-gray-300 rather than text-gray-500: #7a7668 on the
 * light surface #f5f3ec is ~3.9:1 and fails WCAG AA.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      data-testid="empty-state"
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 bg-gray-900/40 px-6 text-center ${
        compact ? 'py-8' : 'py-14'
      }`}
    >
      {icon && <div className="mb-2 text-gray-600">{icon}</div>}
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {hint && <p className="mt-1 max-w-md text-xs text-gray-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
