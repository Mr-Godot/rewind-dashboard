import * as fs from 'node:fs'
import * as path from 'node:path'
import { getProjectsDir } from '../utils/claude-path'

// With lock dir: covers long Claude generations + user think time between turns.
// Trade-off: orphaned lock dirs show as active for up to 15 min.
const LOCK_THRESHOLD_MS = 900_000   // 15 minutes

// Without lock dir: only mtime signals activity (lock dir may not exist yet or at all)
const MTIME_THRESHOLD_MS = 120_000  // 2 minutes — tight window, avoids stale ghosts

/**
 * Check if a session is active by examining:
 * 1. Lock directory exists + mtime < 15 min (session open, may be mid-generation or idle)
 * 2. No lock dir but mtime < 2 min (lock dir may be delayed or absent)
 */
export async function isSessionActive(
  projectDirName: string,
  sessionId: string,
): Promise<boolean> {
  const projectsDir = getProjectsDir()
  const jsonlPath = path.join(projectsDir, projectDirName, `${sessionId}.jsonl`)
  const lockDirPath = path.join(projectsDir, projectDirName, sessionId)

  const stat = await fs.promises.stat(jsonlPath).catch(() => null)
  if (!stat) return false

  const age = Date.now() - stat.mtimeMs

  // Lock directory exists — trust it with wider window (user may be reading)
  const lockStat = await fs.promises.stat(lockDirPath).catch(() => null)
  if (lockStat?.isDirectory()) return age <= LOCK_THRESHOLD_MS

  // No lock dir — only recent JSONL writes count
  return age <= MTIME_THRESHOLD_MS
}
