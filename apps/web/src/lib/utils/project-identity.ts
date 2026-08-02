/**
 * Display names derived from the cwd recorded inside a session JSONL.
 *
 * The encoded ~/.claude/projects dir name is lossy (both `\` and `_` become `-`)
 * so it can never be decoded back into a real path. The recorded cwd is exact,
 * so it is the only source of truth for project identity.
 *
 * Pure string logic on purpose: no node builtins, safe to import anywhere.
 */

/** Segments that name a sub-folder of a project rather than the project. */
const GENERIC_SEGMENTS = new Set(['web', 'src', 'app', 'apps', 'forms', 'downloads', 'dist'])

/** Cap on how far the generic-segment walk may climb on its own. */
const MAX_AUTO_SEGMENTS = 3

/** Cap on how far the collision walk may climb. Deeper paths are vanishingly rare. */
const MAX_DISAMBIGUATION_DEPTH = 8

/** Split on both separators so a Windows path never collapses to one segment. */
export function splitPathSegments(p: string): string[] {
  return p.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

function isGenericSegment(segment: string): boolean {
  return GENERIC_SEGMENTS.has(segment.toLowerCase()) || /^\d+$/.test(segment)
}

/**
 * Name for one path. NOT path.basename: that returns '' for a drive root and
 * turns `...\rewind-dashboard\apps\web` into a useless `web`.
 *
 * `extraDepth` prepends further parent segments, used to split ties between two
 * different projects whose paths end in the same segment.
 */
export function deriveProjectName(realPath: string, extraDepth = 0): string {
  const segments = splitPathSegments(realPath)
  if (segments.length === 0) return realPath.trim() || 'unknown'

  let depth = 1
  while (
    depth < segments.length &&
    depth < MAX_AUTO_SEGMENTS &&
    isGenericSegment(segments[segments.length - depth])
  ) {
    depth++
  }
  depth = Math.min(segments.length, depth + Math.max(0, extraDepth))

  return segments.slice(segments.length - depth).join('/')
}

export interface ProjectIdentityInput {
  /** Stable unique key, i.e. the encoded on-disk project dir name. */
  key: string
  /** cwd recorded in the JSONL, or null when no session recorded one. */
  realPath: string | null
  /** Legacy decoded name, used only when realPath is null. */
  fallbackName: string
}

/**
 * Resolve one display name per key, guaranteeing DISTINCT names: two dirs whose
 * paths end in the same segment (the real `_work` vs `_CODE` rewind-dashboard
 * pair) both grow a parent segment until they differ.
 */
export function resolveProjectNames(inputs: ProjectIdentityInput[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const input of inputs) {
    names.set(input.key, input.realPath ? deriveProjectName(input.realPath) : input.fallbackName)
  }

  const withPath = inputs.filter((input) => input.realPath !== null)
  for (let depth = 1; depth <= MAX_DISAMBIGUATION_DEPTH; depth++) {
    const counts = new Map<string, number>()
    for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1)

    const colliding = withPath.filter((input) => (counts.get(names.get(input.key) ?? '') ?? 0) > 1)
    if (colliding.length === 0) break
    for (const input of colliding) {
      names.set(input.key, deriveProjectName(input.realPath as string, depth))
    }
  }

  // Last resort for names a longer path can never separate (identical cwds, or
  // two fallbacks decoding alike): the key itself is unique by construction.
  const used = new Set<string>()
  for (const input of inputs) {
    const name = names.get(input.key) as string
    const unique = used.has(name) ? `${name} (${input.key})` : name
    used.add(unique)
    names.set(input.key, unique)
  }

  return names
}
