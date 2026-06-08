import { queryOptions } from '@tanstack/react-query'
import { getMetadata } from './metadata.api'

export const metadataQuery = queryOptions({
  queryKey: ['metadata'],
  queryFn: () => getMetadata(),
  staleTime: 5_000,
})
