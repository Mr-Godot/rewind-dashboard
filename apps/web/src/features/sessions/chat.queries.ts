import { queryOptions } from '@tanstack/react-query'
import { getChatMessages } from './chat.api'

export function chatQuery(sessionId: string, projectPath: string) {
  return queryOptions({
    queryKey: ['session', 'chat', sessionId],
    queryFn: () => getChatMessages({ data: { sessionId, projectPath } }),
    staleTime: 60_000,
  })
}
