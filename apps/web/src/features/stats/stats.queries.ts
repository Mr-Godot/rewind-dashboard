import { queryOptions } from '@tanstack/react-query'
import { getStats } from './stats.api'

export const statsQuery = queryOptions({
  queryKey: ['stats'],
  queryFn: () => getStats(),
  staleTime: 120_000,
  refetchInterval: 120_000,
})
