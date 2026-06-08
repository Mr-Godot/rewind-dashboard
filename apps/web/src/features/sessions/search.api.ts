import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { createServerFn } from '@tanstack/react-start'
import { getProjectsDir, decodeProjectDirName, extractProjectName } from '@/lib/utils/claude-path'

export interface SearchHit {
  sessionId: string
  projectPath: string
  projectName: string
  snippet: string
  timestamp: string
}

/**
 * Full-text search across all session JSONL files.
 * Scans user and assistant message text blocks for the query string.
 * Returns matching session IDs with a text snippet.
 */
export const searchConversations = createServerFn({ method: 'GET' })
  .inputValidator((input: { query: string; limit?: number }) => input)
  .handler(async ({ data }): Promise<SearchHit[]> => {
    const query = data.query.toLowerCase()
    if (query.length < 2) return []
    const limit = data.limit ?? 20

    const projectsDir = getProjectsDir()
    let projectDirs: string[]
    try {
      projectDirs = fs.readdirSync(projectsDir)
    } catch (_) {
      return []
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

    return hits
  })

async function searchFile(filePath: string, query: string): Promise<{ snippet: string; timestamp: string } | null> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch (_) {
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
            const snippet = (start > 0 ? '...' : '') + text.slice(start, end).trim() + (end < text.length ? '...' : '')
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
