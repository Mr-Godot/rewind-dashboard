import * as fs from 'node:fs'
import * as path from 'node:path'
import { getProjectsDir } from '../utils/claude-path'

// A session is "active" only when its JSONL file was written very recently.
// NOTE (#29): <projectsDir>/<projectDir>/<sessionId> is the persistent
// subagents/tool-results directory — created the first time a session uses
// subagents and kept forever. It is NOT a liveness signal, so it must not gate
// activity. We use a single, consistent mtime threshold instead.
const MTIME_THRESHOLD_MS = 120_000  // 2 minutes — tight window, avoids stale ghosts

/**
 * Check if a session is active by examining the JSONL file's mtime against a
 * single inactivity threshold. Recent write (< 2 min) = active.
 */
export async function isSessionActive(
  projectDirName: string,
  sessionId: string,
): Promise<boolean> {
  const projectsDir = getProjectsDir()
  const jsonlPath = path.join(projectsDir, projectDirName, `${sessionId}.jsonl`)

  const stat = await fs.promises.stat(jsonlPath).catch(() => null)
  if (!stat) return false

  return Date.now() - stat.mtimeMs <= MTIME_THRESHOLD_MS
}
