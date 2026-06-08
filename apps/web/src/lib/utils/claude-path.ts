import * as path from 'node:path'
import * as os from 'node:os'

function resolveClaudeDir(): string {
  if (process.env.CLAUDE_HOME) {
    return path.resolve(process.env.CLAUDE_HOME)
  }
  return path.join(os.homedir(), '.claude')
}

const CLAUDE_DIR = resolveClaudeDir()

export function getClaudeDir(): string {
  return CLAUDE_DIR
}

export function getProjectsDir(): string {
  return path.join(CLAUDE_DIR, 'projects')
}

export function getStatsPath(): string {
  return path.join(CLAUDE_DIR, 'stats-cache.json')
}

export function getHistoryPath(): string {
  return path.join(CLAUDE_DIR, 'history.jsonl')
}

/**
 * Common intermediate directory names that appear between the home directory
 * and a project directory. Used as split points when decoding lossy Unix paths.
 */
const KNOWN_DIRS = new Set([
  'Documents', 'GitHub', 'Desktop', 'Downloads',
  'projects', 'repos', 'code', 'work', 'src',
  'Sites', 'Applications', 'Library',
  'Workspace', 'workspace', 'go', 'git', 'opt',
])

/**
 * Best-effort decode of a lossy-encoded Unix path.
 * Strategy: match homedir prefix greedily, then split on known directory names,
 * preserving hyphens within unrecognised segments (which are likely literal).
 * Assumes the dashboard runs under the same user whose ~/.claude is being scanned.
 */
function decodeUnixDirName(dirName: string, homedir?: string): string {
  // Strip leading dash and split on dashes to get raw segments
  const raw = dirName.startsWith('-') ? dirName.slice(1) : dirName
  const segments = raw.split('-')
  if (segments.length === 0) return `/${raw}`

  const home = homedir ?? os.homedir()
  const homeSegments = home.split('/').filter(Boolean) // e.g. ['Users','alice']
  const result: string[] = []
  let i = 0

  // 1. Greedily match home directory prefix
  for (const hs of homeSegments) {
    if (i < segments.length && segments[i] === hs) {
      result.push(segments[i])
      i++
    } else {
      break
    }
  }

  // 2. Consume remaining segments: split on known dirs, join the rest with '-'
  while (i < segments.length) {
    if (KNOWN_DIRS.has(segments[i])) {
      result.push(segments[i])
      i++
    } else {
      // Everything from here to the next known-dir (or end) is one hyphenated name
      const parts: string[] = []
      while (i < segments.length && !KNOWN_DIRS.has(segments[i])) {
        parts.push(segments[i])
        i++
      }
      result.push(parts.join('-'))
    }
  }

  return '/' + result.join('/')
}

/**
 * Decode a project directory name back to a filesystem path.
 * ~/.claude/projects stores dirs like "-Users-username-Documents-GitHub-foo"
 * which maps to "/Users/username/Documents/GitHub/foo"
 */
export function decodeProjectDirName(dirName: string, homedir?: string): string {
  // Claude Code's encoding is lossy: \, /, :, _, and literal - all become -
  // When -- exists, it reliably marks a path separator or special char boundary,
  // so single - can be kept as a literal hyphen (preserves names like project-x).
  // When no -- exists (pure Unix paths), every - is a path separator.

  const hasDoubleDash = dirName.includes('--')

  if (hasDoubleDash) {
    // Windows-style path: "C--Users-godot--work-project-x"
    const driveMatch = dirName.match(/^([A-Za-z])--(.*)$/)
    if (driveMatch) {
      const rest = driveMatch[2].replace(/--/g, '/').replace(/-/g, '-')
      return `${driveMatch[1].toUpperCase()}:/${rest}`
    }
    // Unix path with special chars (e.g. underscore dirs): "--" marks separators
    if (dirName.startsWith('-')) {
      const rest = dirName.slice(1).replace(/--/g, '/').replace(/-/g, '-')
      return `/${rest}`
    }
    return dirName.replace(/--/g, '/').replace(/-/g, '-')
  }

  // No double-dash: Unix path — but the encoding is lossy (/ and literal - both become -).
  // Use os.homedir() to identify the known prefix, then preserve hyphens in the remainder.
  return decodeUnixDirName(dirName, homedir)
}

/**
 * Extract a meaningful project name from a decoded path.
 * Returns the last path segment as the project name.
 * If the last segment is purely numeric, prepends the parent segment for context.
 * Strips leading noise-word prefixes that result from lossy path decoding
 * (e.g. "work-project-x" → "project-x" because "work" was a separate directory).
 *
 * "C:/Users-godot/work-project-x" -> "project-x"
 * "/Users/user/projects/mycallagent" -> "mycallagent"
 * "/Users/user/AGENTS/CRM/1" -> "CRM/1"
 * "C:/Users-godot-OneDrive/LIVE/CODE-rewind-dashboard" -> "rewind-dashboard"
 */
export function extractProjectName(decodedPath: string): string {
  const segments = decodedPath.split('/').filter(Boolean)
  if (segments.length === 0) return decodedPath

  let basename = segments[segments.length - 1]

  // Strip leading noise-word prefixes caused by lossy path decoding.
  // E.g. "work-project-x" → "project-x" (because "work\" became "work-")
  // E.g. "CODE-rewind-dashboard" → "rewind-dashboard"
  const noise = new Set(['users', 'home', 'documents', 'github', 'onedrive', 'projects', 'code', 'work', 'c', 'live'])
  const dashIdx = basename.indexOf('-')
  if (dashIdx > 0) {
    const prefix = basename.slice(0, dashIdx)
    if (noise.has(prefix.toLowerCase())) {
      basename = basename.slice(dashIdx + 1)
    }
  }

  // If basename is purely numeric (e.g. "1", "26"), prepend parent for context
  if (/^\d+$/.test(basename) && segments.length >= 2) {
    const parent = segments[segments.length - 2]
    return `${parent}/${basename}`
  }

  return basename
}

/**
 * Extract session ID from a JSONL filename.
 * "abc-123.jsonl" -> "abc-123"
 */
export function extractSessionId(filename: string): string {
  return filename.replace(/\.jsonl$/, '')
}
