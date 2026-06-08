import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  pinSession,
  renameSession,
  pinProject,
  hideProject,
  renameProject,
} from './metadata.api'

function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['metadata'] })
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    queryClient.invalidateQueries({ queryKey: ['projects', 'analytics'] })
  }
}

export function usePinSession() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { sessionId: string; pinned: boolean }) =>
      pinSession({ data: args }),
    onSuccess: invalidate,
  })
}

export function useRenameSession() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { sessionId: string; customName: string }) =>
      renameSession({ data: args }),
    onSuccess: invalidate,
  })
}

export function usePinProject() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { projectPath: string; pinned: boolean }) =>
      pinProject({ data: args }),
    onSuccess: invalidate,
  })
}

export function useHideProject() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { projectPath: string; hidden: boolean }) =>
      hideProject({ data: args }),
    onSuccess: invalidate,
  })
}

export function useRenameProject() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { projectPath: string; customName: string }) =>
      renameProject({ data: args }),
    onSuccess: invalidate,
  })
}
