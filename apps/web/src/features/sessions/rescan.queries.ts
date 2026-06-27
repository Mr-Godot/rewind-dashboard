import { useMutation, useQueryClient } from '@tanstack/react-query'
import { rescanSessions } from './rescan.api'

/**
 * Force a cold rescan, then invalidate every query that depends on the cache:
 * sessions (list/active/paginated), projects (analytics) and metadata.
 */
export function useRescan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => rescanSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['metadata'] })
    },
  })
}
