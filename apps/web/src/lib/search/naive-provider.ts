import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { getProjectsDir, decodeProjectDirName, extractProjectName } from '../utils/claude-path'
import { readTitleSource, resolveTitle } from './title-source'
import { matchesTerms, tokenizeQuery } from './name-match'
import {
  emptyIndexStats,
  type IndexStats,
  type SearchHit,
  type SearchProvider,
  type SearchQuery,
  type SearchResult,
} from './provider'

/**
 * Always-available fallback provider. Re-implements the original substring scan
 * verbatim: it streams each session file in fs.readdir order, returns the first
 * matching user/assistant text block per file, and hard-stops at the limit.
 * refresh() is a no-op since there is no index.
 */
export class NaiveSearchProvider implements SearchProvider {
  readonly name = 'naive'

  isAvailable(): boolean {
    return true
  }

  async refresh(): Promise<IndexStats> {
    return emptyIndexStats()
  }

  async search(input: SearchQuery): Promise<SearchResult> {
    const start = Date.now()
    const query = input.query.toLowerCase()
    if (query.length < 2) {
      return { hits: [], total: 0, tookMs: Date.now() - start, provider: this.name }
    }
    const limit = input.limit ?? 20

    const projectsDir = getProjectsDir()
    let projectDirs: string[]
    try {
      projectDirs = fs.readdirSync(projectsDir)
    } catch {
      return { hits: [], total: 0, tookMs: Date.now() - start, provider: this.name }
    }

    // Flatten first so name matches can be emitted ahead of body matches, the
    // same precedence the SQLite provider gets from `tm DESC`. Without this a
    // session renamed to a label that appears nowhere in its transcript is
    // unfindable on machines with no native sqlite driver.
    const entries: { sessionId: string; filePath: string; decodedPath: string; projectName: string }[] = []
    for (const dirName of projectDirs) {
      const dirPath = path.join(projectsDir, dirName)
      const stat = fs.statSync(dirPath, { throwIfNoEntry: false })
      if (!stat?.isDirectory()) continue

      const decodedPath = decodeProjectDirName(dirName)
      const projectName = extractProjectName(decodedPath)
      for (const file of fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))) {
        entries.push({
          sessionId: file.replace('.jsonl', ''),
          filePath: path.join(dirPath, file),
          decodedPath,
          projectName,
        })
      }
    }

    const hits: SearchHit[] = []
    const matchedIds = new Set<string>()

    const { titles } = readTitleSource()
    const terms = tokenizeQuery(input.query)
    if (terms.length > 0) {
      for (const entry of entries) {
        if (hits.length >= limit) break
        const title = resolveTitle(titles.get(entry.sessionId))
        if (!title || !matchesTerms(title, terms)) continue
        matchedIds.add(entry.sessionId)
        const fileStat = fs.statSync(entry.filePath, { throwIfNoEntry: false })
        hits.push({
          sessionId: entry.sessionId,
          projectPath: entry.decodedPath,
          projectName: entry.projectName,
          snippet: title,
          timestamp: fileStat ? new Date(fileStat.mtimeMs).toISOString() : '',
          blockType: 'title',
          title,
          titleMatch: true,
        })
      }
    }

    for (const entry of entries) {
      if (hits.length >= limit) break
      if (matchedIds.has(entry.sessionId)) continue

      const found = await searchFile(entry.filePath, query)
      if (found) {
        hits.push({
          sessionId: entry.sessionId,
          projectPath: entry.decodedPath,
          projectName: entry.projectName,
          snippet: found.snippet,
          timestamp: found.timestamp,
          title: resolveTitle(titles.get(entry.sessionId)),
        })
      }
    }

    return { hits, total: hits.length, tookMs: Date.now() - start, provider: this.name }
  }
}

async function searchFile(
  filePath: string,
  query: string,
): Promise<{ snippet: string; timestamp: string } | null> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }

      if (msg.type !== 'user' && msg.type !== 'assistant') continue
      const content = msg.message?.content
      if (!content || !Array.isArray(content)) continue

      for (const block of content) {
        if (block.type === 'text' && block.text) {
          const text = block.text as string
          const idx = text.toLowerCase().indexOf(query)
          if (idx !== -1) {
            const start = Math.max(0, idx - 40)
            const end = Math.min(text.length, idx + query.length + 80)
            const snippet =
              (start > 0 ? '...' : '') +
              text.slice(start, end).trim() +
              (end < text.length ? '...' : '')
            return { snippet, timestamp: (msg.timestamp as string) ?? '' }
          }
        }
      }
    }

    return null
  } finally {
    rl.close()
    stream.destroy()
  }
}
