/**
 * Session names for the search index, read straight off disk.
 *
 * `src/lib/**` must not import `src/features/**`, so the two on-disk shapes
 * consumed here are parsed locally rather than through the feature slices that
 * own them. If `session-metadata.json` (features/metadata) or
 * `session-summaries.json` (lib/scanner) ever change shape, both readers need
 * updating. The duplication is deliberate and cheap: two optional string
 * fields, read defensively.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getDashboardDir } from '../utils/claude-path'
import { getCacheDir } from '../cache/disk-cache'

export interface SessionTitleRecord {
  /** Rewind rename. */
  customName?: string
  /** Claude Code `/rename` title recorded in the JSONL. */
  claudeName?: string | null
}

export interface TitleSource {
  titles: Map<string, SessionTitleRecord>
  /** mtime of session-metadata.json, or 0 when it is missing/unreadable. */
  metadataMtimeMs: number
}

function metadataPath(): string {
  return path.join(getDashboardDir(), 'session-metadata.json')
}

function summariesPath(): string {
  return path.join(getCacheDir(), 'session-summaries.json')
}

/** Cheap change token for a file: mtime and size, or null when absent. */
function fingerprint(file: string): string {
  try {
    const stat = fs.statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return '0:0'
  }
}

let cached: { key: string; source: TitleSource } | null = null

/**
 * Union of every name a session can be found by. Neither file is required:
 * a missing or malformed one contributes nothing and never throws.
 *
 * Memoized on the two source fingerprints. This runs on every search, and
 * session-summaries.json is megabytes on a busy machine, so re-parsing it per
 * keystroke is not affordable.
 */
export function readTitleSource(): TitleSource {
  const key = `${fingerprint(metadataPath())}|${fingerprint(summariesPath())}`
  if (cached && cached.key === key) return cached.source
  const source = loadTitleSource()
  cached = { key, source }
  return source
}

function loadTitleSource(): TitleSource {
  const titles = new Map<string, SessionTitleRecord>()
  let metadataMtimeMs = 0

  try {
    const file = metadataPath()
    metadataMtimeMs = fs.statSync(file).mtimeMs
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      sessions?: Record<string, { customName?: unknown }>
    }
    for (const [sessionId, entry] of Object.entries(parsed?.sessions ?? {})) {
      const customName = entry?.customName
      if (typeof customName === 'string' && customName.trim()) {
        titles.set(sessionId, { customName })
      }
    }
  } catch {
    metadataMtimeMs = 0
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(summariesPath(), 'utf-8')) as {
      entries?: Record<string, { summary?: { claudeName?: unknown } }>
    }
    for (const [sessionId, entry] of Object.entries(parsed?.entries ?? {})) {
      const claudeName = entry?.summary?.claudeName
      if (typeof claudeName === 'string' && claudeName.trim()) {
        const existing = titles.get(sessionId)
        if (existing) existing.claudeName = claudeName
        else titles.set(sessionId, { claudeName })
      }
    }
  } catch {
    // No summaries cache yet: customName alone still indexes.
  }

  return { titles, metadataMtimeMs }
}

/** Display precedence, mirroring the session card: customName > claudeName. */
export function resolveTitle(record: SessionTitleRecord | undefined): string | null {
  if (!record) return null
  return record.customName || record.claudeName || null
}
