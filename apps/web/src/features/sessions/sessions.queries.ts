import { queryOptions, keepPreviousData } from '@tanstack/react-query'
import { getSessionList, getActiveSessionList, getPaginatedSessions } from './sessions.api'

export const sessionListQuery = queryOptions({
  queryKey: ['sessions', 'list'],
  queryFn: () => getSessionList(),
  refetchInterval: 30_000,
})

export const activeSessionsQuery = queryOptions({
  queryKey: ['sessions', 'active'],
  queryFn: () => getActiveSessionList(),
  refetchInterval: 3_000,
})

interface PaginatedSessionParams {
  page: number
  pageSize: number
  search: string
  status: 'all' | 'active' | 'completed'
  project: string
  sort: string
  starFirst: boolean
}

export function paginatedSessionListQuery(params: PaginatedSessionParams & { hasActive?: boolean }) {
  const { hasActive, ...data } = params
  return queryOptions({
    queryKey: ['sessions', 'paginated', data],
    queryFn: () => getPaginatedSessions({ data }),
    staleTime: hasActive ? 5_000 : 30_000,
    placeholderData: keepPreviousData,
    refetchInterval: hasActive ? 5_000 : 30_000,
  })
}
