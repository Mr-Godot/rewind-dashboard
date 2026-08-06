import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { detectTerminals, redetectTerminals } from './terminal.api'

/**
 * Terminals do not get installed while the dashboard is open, so this never
 * goes stale on its own. The Settings re-detect button is the only invalidator.
 */
export const terminalsQuery = queryOptions({
  queryKey: ['terminals'],
  queryFn: () => detectTerminals(),
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnWindowFocus: false,
})

export function useRedetectTerminals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => redetectTerminals(),
    onSuccess: (result) => {
      queryClient.setQueryData(['terminals'], result)
    },
  })
}
