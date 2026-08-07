/**
 * Separator-insensitive name matching, shared by the session list and the
 * search index.
 *
 * Client-safe on purpose: no node builtins, so `sessions.api.ts` and any
 * component can import it. The old matcher lowercased the whole query and ran
 * one String.includes, which made `'orbit-crm-v2'.includes('orbit crm')`
 * false and hid every renamed session from its own name.
 */

/** Cap on the number of terms built from a single query. */
const MAX_TERMS = 16

/**
 * Fold a string to lowercase words separated by single spaces: diacritics
 * stripped, and every run of non-alphanumeric characters (`-`, `_`, `.`, `/`,
 * `\`, `:`, whitespace) collapsed to one separator.
 */
export function normalizeForSearch(input: string): string {
  if (!input) return ''
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Normalized, de-empted, capped query terms. */
export function tokenizeQuery(raw: string): string[] {
  const normalized = normalizeForSearch(raw)
  if (!normalized) return []
  return normalized.split(' ').filter(Boolean).slice(0, MAX_TERMS)
}

/**
 * Term-AND matching: every term must either prefix one of the haystack's tokens
 * or appear anywhere inside the normalized haystack. Case and separator
 * insensitive.
 */
export function matchesTerms(
  haystack: string | null | undefined,
  terms: string[],
): boolean {
  if (!haystack || terms.length === 0) return false
  const normalized = normalizeForSearch(haystack)
  if (!normalized) return false
  const tokens = normalized.split(' ')
  return terms.every(
    (term) => tokens.some((token) => token.startsWith(term)) || normalized.includes(term),
  )
}

/** Normalized equality between a name and an already-normalized query. */
export function isExactName(
  name: string | null | undefined,
  normalizedQuery: string,
): boolean {
  if (!name || !normalizedQuery) return false
  return normalizeForSearch(name) === normalizedQuery
}

/** Normalized startsWith between a name and an already-normalized query. */
export function isPrefixName(
  name: string | null | undefined,
  normalizedQuery: string,
): boolean {
  if (!name || !normalizedQuery) return false
  return normalizeForSearch(name).startsWith(normalizedQuery)
}

/**
 * True when the terms prefix-match the name's LEADING tokens, in order.
 * `orbit crm` leads `orbit-crm-v2`; `brain` does not lead `agent-brain`.
 */
function leadsWithTerms(name: string | null | undefined, terms: string[]): boolean {
  if (!name || terms.length === 0) return false
  const tokens = normalizeForSearch(name).split(' ').filter(Boolean)
  if (terms.length > tokens.length) return false
  return terms.every((term, i) => tokens[i].startsWith(term))
}

/**
 * Match tier, lower is better. 0-2 are name matches, 3 project, 4 identifiers,
 * 5 the first user message, 6 conversation body (FTS panel only).
 */
export type NameRank = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface SessionMatchFields {
  customName?: string | null
  claudeName?: string | null
  projectName?: string | null
  projectDir?: string | null
  branch?: string | null
  cwd?: string | null
  sessionId?: string | null
  firstUserMessage?: string | null
}

/**
 * Rank one session against the query terms, or null when nothing matched.
 * `customName` and `claudeName` are a union, not a precedence: a session
 * renamed twice must be findable by either name.
 */
export function rankSessionMatch(
  fields: SessionMatchFields,
  terms: string[],
): NameRank | null {
  if (terms.length === 0) return null
  const normalizedQuery = terms.join(' ')
  const names = [fields.customName, fields.claudeName]

  if (names.some((n) => isExactName(n, normalizedQuery))) return 0
  if (names.some((n) => isPrefixName(n, normalizedQuery) || leadsWithTerms(n, terms))) return 1
  if (names.some((n) => matchesTerms(n, terms))) return 2
  if (matchesTerms(fields.projectName, terms) || matchesTerms(fields.projectDir, terms)) return 3
  if (matchesTerms(fields.branch, terms) || matchesTerms(fields.cwd, terms)) return 4
  // The session id keeps a RAW case-insensitive substring test so pasting an
  // 8-character prefix still works.
  if (fields.sessionId) {
    const rawId = fields.sessionId.toLowerCase()
    if (terms.every((t) => rawId.includes(t))) return 4
  }
  if (matchesTerms(fields.firstUserMessage, terms)) return 5
  return null
}
