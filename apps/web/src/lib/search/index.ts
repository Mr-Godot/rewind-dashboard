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
let announced = false

/**
 * Announce the selected provider once per process. A silent degrade to the
 * naive provider (one hit per file, text blocks only, no-op refresh) is
 * otherwise undiagnosable from the outside.
 */
function announce(provider: SearchProvider, reason?: string): SearchProvider {
  if (!announced) {
    announced = true
    if (reason) console.warn('[search] falling back to the naive provider:', reason)
    console.info('[search] provider =', provider.name)
  }
  return provider
}

function selectSqlite(): SearchProvider {
  const sqlite = new SqliteSearchProvider()
  if (sqlite.isAvailable()) return announce(sqlite)
  return announce(
    new NaiveSearchProvider(),
    'the better-sqlite3 driver could not be loaded. Recall is reduced to text blocks only, at most one hit per file',
  )
}

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
    cached = announce(new NaiveSearchProvider())
    return cached
  }
  if (choice === 'qmd') {
    cached = announce(new QmdSearchProvider())
    return cached
  }

  cached = selectSqlite()
  return cached
}

/** Reset the memoized provider (closing it if needed). Primarily for tests. */
export function resetSearchProvider(): void {
  if (cached?.close) cached.close()
  cached = null
  announced = false
}
