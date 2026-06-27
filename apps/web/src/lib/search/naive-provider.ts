import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { getProjectsDir, decodeProjectDirName, extractProjectName } from '../utils/claude-path'
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

    const hits: SearchHit[] = []

    for (const dirName of projectDirs) {
      if (hits.length >= limit) break
      const dirPath = path.join(projectsDir, dirName)
      const stat = fs.statSync(dirPath, { throwIfNoEntry: false })
      if (!stat?.isDirectory()) continue

      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))
      const decodedPath = decodeProjectDirName(dirName)
      const projectName = extractProjectName(decodedPath)

      for (const file of files) {
        if (hits.length >= limit) break
        const sessionId = file.replace('.jsonl', '')
        const filePath = path.join(dirPath, file)

        const found = await searchFile(filePath, query)
        if (found) {
          hits.push({
            sessionId,
            projectPath: decodedPath,
            projectName,
            snippet: found.snippet,
            timestamp: found.timestamp,
          })
        }
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
