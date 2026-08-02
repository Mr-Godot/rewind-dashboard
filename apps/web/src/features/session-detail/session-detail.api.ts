import * as path from 'node:path'
import * as fs from 'node:fs'
import { createServerFn } from '@tanstack/react-start'
import { getProjectsDir, decodeProjectDirName } from '@/lib/utils/claude-path'
import { deriveProjectName } from '@/lib/utils/project-identity'
import { parseDetail } from '@/lib/parsers/session-parser'

/**
 * Same rule the list uses: the recorded cwd wins, the lossy decoded path is only
 * a fallback. extractProjectName is deliberately NOT used — its noise-word
 * stripper turns a real `code-review` into `review`.
 */
export function resolveDetailProjectName(cwd: string | null, projectPath: string): string {
  return deriveProjectName(cwd || projectPath)
}

export const getSessionDetail = createServerFn({ method: 'GET' })
  .inputValidator((input: { sessionId: string; projectPath: string }) => input)
  .handler(async ({ data }) => {
    const filePath = findSessionFile(data.sessionId, data.projectPath)
    if (!filePath) {
      // The JSONL was deleted/rotated after the list was cached. Return a typed
      // result so the UI can show a graceful state instead of a raw error.
      return { notFound: true as const, sessionId: data.sessionId }
    }

    try {
      const detail = await parseDetail(
        filePath.path,
        data.sessionId,
        data.projectPath,
        resolveDetailProjectName(null, data.projectPath),
      )
      return { ...detail, projectName: resolveDetailProjectName(detail.cwd, data.projectPath) }
    } catch {
      // File vanished mid-parse or is corrupt/truncated.
      return { notFound: true as const, sessionId: data.sessionId }
    }
  })

/** Exported for testing: the primary (decoded-path) match must stay reachable. */
export function findSessionFile(
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
