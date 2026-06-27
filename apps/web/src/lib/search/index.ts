import type { SearchProvider } from './provider'
import { SqliteSearchProvider } from './sqlite-provider'
import { NaiveSearchProvider } from './naive-provider'
import { QmdSearchProvider } from './qmd-provider'

export type {
  SearchProvider,
  SearchQuery,
  SearchResult,
  SearchHit,
  IndexStats,
  BlockType,
} from './provider'

let cached: SearchProvider | null = null

/**
 * Memoized provider factory.
 *
 * Selection order:
 *   1. REWIND_SEARCH_PROVIDER env (sqlite | naive | qmd) when set. For sqlite,
 *      falls back to naive if the native driver cannot load.
 *   2. Default: sqlite when the better-sqlite3 driver loads, otherwise naive.
 *
 * QMD is only ever returned when explicitly selected.
 */
export function getSearchProvider(): SearchProvider {
  if (cached) return cached

  const choice = process.env.REWIND_SEARCH_PROVIDER?.toLowerCase()

  if (choice === 'naive') {
    cached = new NaiveSearchProvider()
    return cached
  }
  if (choice === 'qmd') {
    cached = new QmdSearchProvider()
    return cached
  }
  if (choice === 'sqlite') {
    const sqlite = new SqliteSearchProvider()
    cached = sqlite.isAvailable() ? sqlite : new NaiveSearchProvider()
    return cached
  }

  const sqlite = new SqliteSearchProvider()
  cached = sqlite.isAvailable() ? sqlite : new NaiveSearchProvider()
  return cached
}

/** Reset the memoized provider (closing it if needed). Primarily for tests. */
export function resetSearchProvider(): void {
  if (cached?.close) cached.close()
  cached = null
}
