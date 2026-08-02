import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { IndexStats, SearchResult } from '@/lib/search/provider'
import type { SearchIndexStatus } from '@/lib/search/search-service'

export type { SearchHit, SearchResult } from '@/lib/search/provider'
export type { SearchIndexStatus } from '@/lib/search/search-service'

/**
 * Server boundary: validate rather than trust. The surface stays deliberately
 * narrow (offset/projectPath/blockTypes/groupBySession are not exposed).
 */
const searchInputSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(200).optional(),
})

/**
 * Full-text search across all session JSONL files.
 *
 * Returns the FULL SearchResult, never a bare array: a swallowed failure that
 * renders as `[]` is indistinguishable from "no matches". Failures come back
 * with `degraded: true` and are logged server-side by the service.
 */
export const searchConversations = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => searchInputSchema.parse(input))
  .handler(async ({ data }): Promise<SearchResult> => {
    const { runConversationSearch } = await import('@/lib/search/search-service')
    return runConversationSearch(data)
  })

/** Force a full rebuild of the search index (for a future rebuild button). */
export const refreshSearchIndex = createServerFn({ method: 'POST' }).handler(
  async (): Promise<IndexStats & { degraded?: boolean }> => {
    const { rebuildSearchIndex } = await import('@/lib/search/search-service')
    return rebuildSearchIndex()
  },
)

/** Report which provider is active, whether it works, and how stale it is. */
export const getSearchIndexStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SearchIndexStatus> => {
    const { readSearchIndexStatus } = await import('@/lib/search/search-service')
    return readSearchIndexStatus()
  },
)
