import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  emptyIndexStats,
  type IndexStats,
  type SearchProvider,
  type SearchQuery,
  type SearchResult,
} from './provider'

/**
 * Opt-in QMD provider stub. Off by default; selected only when
 * REWIND_SEARCH_PROVIDER=qmd. isAvailable() merely checks whether a `qmd`
 * binary is on PATH (no process is spawned). refresh() and search() are
 * deliberate no-ops for v1 — this provider NEVER runs qmd index commands.
 */
export class QmdSearchProvider implements SearchProvider {
  readonly name = 'qmd'

  isAvailable(): boolean {
    const pathEnv = process.env.PATH ?? ''
    if (!pathEnv) return false
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) continue
      for (const ext of exts) {
        try {
          if (fs.existsSync(path.join(dir, `qmd${ext}`))) return true
        } catch {
          // Unreadable PATH entry — keep scanning.
        }
      }
    }
    return false
  }

  async refresh(): Promise<IndexStats> {
    // Never auto-run qmd index commands.
    return emptyIndexStats()
  }

  async search(_query: SearchQuery): Promise<SearchResult> {
    return { hits: [], total: 0, tookMs: 0, provider: this.name, degraded: true }
  }
}
