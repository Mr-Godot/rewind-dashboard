import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Decides WHERE (and whether) a `claude --resume` terminal may be spawned.
 * Server-only: imported by the Vite dev middleware, never by client code.
 */

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LaunchTarget =
  | { ok: true; sessionId: string; sessionCwd: string }
  | { ok: false; status: 400 | 409; error: string }

/** First cwd recorded in the head of a session JSONL, or null. */
function readCwdFromHead(jsonlPath: string): string | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(jsonlPath, 'r')
    const buf = Buffer.alloc(4096)
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0)
    for (const line of buf.toString('utf8', 0, bytesRead).split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.cwd) return parsed.cwd as string
      } catch {
        // Partial trailing line or non-JSON noise — keep looking.
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // Already closed / never opened.
      }
    }
  }
}

/**
 * Locate the session's JSONL and return the cwd it recorded. Terminates on
 * FILE-FOUND: the dir holding the file is the session's dir, whether or not it
 * yielded a cwd. The old loop kept scanning every remaining project dir.
 */
export function readRecordedCwd(projectsDir: string, sessionId: string): string | null {
  let dirs: string[]
  try {
    dirs = fs.readdirSync(projectsDir)
  } catch {
    return null
  }

  for (const dirName of dirs) {
    const jsonl = path.join(projectsDir, dirName, `${sessionId}.jsonl`)
    if (!fs.existsSync(jsonl)) continue
    return readCwdFromHead(jsonl)
  }
  return null
}

/**
 * Validate the request and resolve the working directory to launch in.
 *
 * A 409 means the recorded directory is gone: the caller must spawn NOTHING.
 * Launching anyway ran `cd /d "<dead path>"`, ignored the failure, and left
 * `claude --resume` running in the wrong project scope where it finds nothing.
 */
export function resolveLaunchTarget(body: unknown, home: string): LaunchTarget {
  const { sessionId, cwd } = (body ?? {}) as { sessionId?: unknown; cwd?: unknown }

  // Validate sessionId is a UUID to prevent command injection
  if (!sessionId || typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return { ok: false, status: 400, error: 'Invalid sessionId: must be a valid UUID' }
  }

  // Validate cwd if provided: must be absolute, no traversal, no shell metacharacters
  if (cwd != null) {
    if (typeof cwd !== 'string') {
      return { ok: false, status: 400, error: 'Invalid cwd: must be a string' }
    }
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('/')
    const hasTraversal = /(^|[\\/])\.\.($|[\\/])/.test(cwd)
    const shellMeta = /[;&|`$(){}!#*?<>\n\r]/.test(cwd)
    if (!isAbsolute || hasTraversal || shellMeta) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid cwd: must be absolute path without traversal or shell metacharacters',
      }
    }
  }

  const projectsDir = path.join(home, '.claude', 'projects')
  const sessionCwd =
    readRecordedCwd(projectsDir, sessionId) ?? (typeof cwd === 'string' && cwd ? cwd : home)

  if (!fs.existsSync(sessionCwd)) {
    return {
      ok: false,
      status: 409,
      error: `Session working directory no longer exists: ${sessionCwd}`,
    }
  }

  return { ok: true, sessionId, sessionCwd }
}
