import * as path from 'node:path'
import * as fs from 'node:fs'
import { createServerFn } from '@tanstack/react-start'
import { getProjectsDir, decodeProjectDirName, extractProjectName } from '@/lib/utils/claude-path'
import { parseDetail } from '@/lib/parsers/session-parser'

export const getSessionDetail = createServerFn({ method: 'GET' })
  .inputValidator((input: { sessionId: string; projectPath: string }) => input)
  .handler(async ({ data }) => {
    const filePath = findSessionFile(data.sessionId, data.projectPath)
    if (!filePath) {
      // The JSONL was deleted/rotated after the list was cached. Return a typed
      // result so the UI can show a graceful state instead of a raw error.
      return { notFound: true as const, sessionId: data.sessionId }
    }

    const projectName = extractProjectName(data.projectPath)
    try {
      return await parseDetail(filePath.path, data.sessionId, data.projectPath, projectName)
    } catch {
      // File vanished mid-parse or is corrupt/truncated.
      return { notFound: true as const, sessionId: data.sessionId }
    }
  })

function findSessionFile(
  sessionId: string,
  projectPath: string,
): { path: string; dirName: string } | null {
  const projectsDir = getProjectsDir()

  // Try to find via projectPath
  let entries: string[]
  try {
    entries = fs.readdirSync(projectsDir)
  } catch {
    return null
  }

  for (const dirName of entries) {
    const decoded = decodeProjectDirName(dirName)
    if (decoded === projectPath || dirName === projectPath) {
      const filePath = path.join(projectsDir, dirName, `${sessionId}.jsonl`)
      if (fs.existsSync(filePath)) {
        return { path: filePath, dirName }
      }
    }
  }

  // Fallback: search all projects
  for (const dirName of entries) {
    const filePath = path.join(projectsDir, dirName, `${sessionId}.jsonl`)
    if (fs.existsSync(filePath)) {
      return { path: filePath, dirName }
    }
  }

  return null
}
