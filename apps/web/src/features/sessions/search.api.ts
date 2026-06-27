import { createServerFn } from '@tanstack/react-start'
import type { IndexStats } from '@/lib/search/provider'

export type { SearchHit } from '@/lib/search/provider'

/**
 * Full-text search across all session JSONL files.
 *
 * Delegates to the configured SearchProvider (SQLite FTS5 by default, with a
 * naive substring fallback). The provider is refreshed (incrementally, throttled)
 * before each search. The returned shape is unchanged from the original API so
 * the UI needs no changes; provider hits already satisfy SearchHit (extra
 * optional fields are simply ignored by the UI).
 */
export const searchConversations = createServerFn({ method: 'GET' })
  .inputValidator((input: { query: string; limit?: number }) => input)
  .handler(async ({ data }) => {
    const query = data.query?.trim() ?? ''
    if (query.length < 2) return []
    const limit = data.limit ?? 20

    try {
      const { getSearchProvider } = await import('@/lib/search')
      const provider = getSearchProvider()
      await provider.refresh()
      const result = await provider.search({ query, limit })
      return result.hits
    } catch {
      return []
    }
  })

/** Force a full rebuild of the search index (for a future rebuild button). */
export const refreshSearchIndex = createServerFn({ method: 'POST' }).handler(
  async (): Promise<IndexStats> => {
    try {
      const { getSearchProvider } = await import('@/lib/search')
      const provider = getSearchProvider()
      return await provider.refresh({ force: true })
    } catch {
      return {
        sessionsIndexed: 0,
        sessionsSkipped: 0,
        sessionsRemoved: 0,
        blocksIndexed: 0,
        durationMs: 0,
      }
    }
  },
)

/** Report which provider is active and whether it is available. */
export const getSearchIndexStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ provider: string; available: boolean }> => {
    try {
      const { getSearchProvider } = await import('@/lib/search')
      const provider = getSearchProvider()
      return { provider: provider.name, available: await provider.isAvailable() }
    } catch {
      return { provider: 'none', available: false }
    }
  },
)
