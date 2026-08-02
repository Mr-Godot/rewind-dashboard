import { useQuery } from '@tanstack/react-query'
import { activeSessionsQuery } from './sessions.queries'
import { countWorkingSessions } from './active-merge'

export function ActiveSessionsBadge() {
  const { data: activeSessions } = useQuery(activeSessionsQuery)
  const count = countWorkingSessions(activeSessions ?? [])

  if (count === 0) return null

  return (
    <span className="ml-auto rounded-full bg-matrix/20 px-1.5 py-0.5 text-[10px] font-medium text-matrix">
      {count}
    </span>
  )
}
