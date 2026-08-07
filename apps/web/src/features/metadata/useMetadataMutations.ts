import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  pinSession,
  hideSession,
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

export function useHideSession() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { sessionId: string; hidden: boolean }) =>
      hideSession({ data: args }),
    onSuccess: invalidate,
  })
}

export function useRenameSession() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { sessionId: string; customName: string }) =>
      renameSession({ data: args }),
    onSuccess: () => {
      invalidate()
      // The conversation panel indexes the name too, so it must re-query.
      queryClient.invalidateQueries({ queryKey: ['fts'] })
    },
  })
}

export function usePinProject() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { projectDir: string; pinned: boolean }) =>
      pinProject({ data: args }),
    onSuccess: invalidate,
  })
}

export function useHideProject() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { projectDir: string; hidden: boolean }) =>
      hideProject({ data: args }),
    onSuccess: invalidate,
  })
}

export function useRenameProject() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (args: { projectDir: string; customName: string }) =>
      renameProject({ data: args }),
    onSuccess: invalidate,
  })
}
