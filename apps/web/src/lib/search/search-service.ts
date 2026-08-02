import { getSearchProvider } from './index'
import type { IndexStats, SearchResult } from './provider'

/**
 * Server-only search entry points.
 *
 * These live outside features/*.api.ts on purpose: the bodies statically import
 * the SQLite provider (node:fs), and a createServerFn handler is the only thing
 * the Start plugin strips from the client bundle. The .api.ts handlers reach
 * this module through a dynamic import inside their handler.
 *
 * Every failure is LOGGED and reported as `degraded`, never collapsed to an
 * empty result: an empty array is indistinguishable from "no matches", which
 * is how a dead search subsystem stayed invisible.
 */

export interface SearchIndexStatus {
  provider: string
  available: boolean
  indexedThrough: string | null
  degraded?: boolean
}

function emptySearchResult(degraded: boolean): SearchResult {
  return {
    hits: [],
    total: 0,
    tookMs: 0,
    provider: 'none',
    degraded: degraded || undefined,
    indexedThrough: null,
  }
}

/** Full-text search across all session JSONL files. */
export async function runConversationSearch(input: {
  query: string
  limit?: number
}): Promise<SearchResult> {
  const query = input.query?.trim() ?? ''
  if (query.length < 2) return emptySearchResult(false)
  const limit = input.limit ?? 20

  try {
    const provider = getSearchProvider()
    // Keep this await: a cold index would otherwise return zero hits that look
    // exactly like "no matches", the bug this whole item exists to fix.
    await provider.refresh()
    return await provider.search({ query, limit })
  } catch (err) {
    console.error('[search]', err)
    return emptySearchResult(true)
  }
}

/** Force a full rebuild of the search index. */
export async function rebuildSearchIndex(): Promise<IndexStats & { degraded?: boolean }> {
  try {
    return await getSearchProvider().refresh({ force: true })
  } catch (err) {
    console.error('[search] index refresh failed:', err)
    return {
      sessionsIndexed: 0,
      sessionsSkipped: 0,
      sessionsRemoved: 0,
      blocksIndexed: 0,
      durationMs: 0,
      degraded: true,
    }
  }
}

/** Which provider is active, whether it works, and how stale its index is. */
export async function readSearchIndexStatus(): Promise<SearchIndexStatus> {
  try {
    const provider = getSearchProvider()
    return {
      provider: provider.name,
      available: await provider.isAvailable(),
      indexedThrough: provider.indexedThrough?.() ?? null,
    }
  } catch (err) {
    console.error('[search] index status unavailable:', err)
    return { provider: 'none', available: false, indexedThrough: null, degraded: true }
  }
}
