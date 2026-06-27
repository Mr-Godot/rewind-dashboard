/**
 * Pluggable conversation-search abstraction.
 *
 * A SearchProvider indexes (refresh) and queries (search) the Claude Code
 * session JSONL files. The default provider is SQLite FTS5; a naive
 * substring-scan provider is the always-available fallback, and a QMD provider
 * is an opt-in stub. The factory in ./index picks one at runtime.
 */

export type BlockType = 'text' | 'tool_use' | 'tool_result' | 'thinking'

/**
 * A single search result. The first five fields are the original, stable shape
 * consumed by the UI. The remaining fields are optional additions — adding them
 * keeps the UI working without changes.
 */
export interface SearchHit {
  sessionId: string
  projectPath: string
  projectName: string
  snippet: string
  timestamp: string
  /** Relevance score (provider-specific; lower bm25 = more relevant). */
  score?: number
  /** Message role the best-matching block came from. */
  role?: string
  /** Kind of block the match came from. */
  blockType?: BlockType
  /** Number of matching blocks within the session (when grouped). */
  matchCount?: number
}

export interface SearchQuery {
  query: string
  limit?: number
  offset?: number
  /** Restrict to a single decoded project path. */
  projectPath?: string
  /** Restrict to specific block types. */
  blockTypes?: BlockType[]
  /** Collapse to the single best block per session (default true). */
  groupBySession?: boolean
}

export interface SearchResult {
  hits: SearchHit[]
  /** Total matches available (sessions when grouped, blocks otherwise). */
  total: number
  tookMs: number
  provider: string
  /** True when the provider ran in a degraded/unavailable mode. */
  degraded?: boolean
}

export interface IndexStats {
  sessionsIndexed: number
  sessionsSkipped: number
  sessionsRemoved: number
  blocksIndexed: number
  durationMs: number
}

export interface SearchProvider {
  name: string
  isAvailable(): boolean | Promise<boolean>
  refresh(opts?: { force?: boolean }): Promise<IndexStats>
  search(query: SearchQuery): Promise<SearchResult>
  close?(): void
}

export function emptyIndexStats(durationMs = 0): IndexStats {
  return {
    sessionsIndexed: 0,
    sessionsSkipped: 0,
    sessionsRemoved: 0,
    blocksIndexed: 0,
    durationMs,
  }
}
