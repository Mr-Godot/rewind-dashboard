/**
 * Single source of truth for a session's display title, shared by the list and
 * the detail route so the two can never drift apart.
 *
 * Precedence: Rewind customName > JSONL custom-title (/rename) > first user
 * message excerpt > fallback (project name).
 *
 * Client-safe on purpose: this module must stay free of node builtins because
 * it is imported by components that render in the browser.
 */
export interface SessionTitleInput {
  /** Rewind-owned rename, from session metadata. */
  customName?: string | null
  /** Claude Code's own /rename title, parsed from the JSONL custom-title record. */
  claudeName?: string | null
  /** Excerpt of the first real user turn. Suppressed in privacy mode. */
  firstUserMessage?: string | null
  /** Already-anonymized project name (or any last-resort label). */
  fallback: string
  privacyMode?: boolean
}

export function resolveSessionTitle({
  customName,
  claudeName,
  firstUserMessage,
  fallback,
  privacyMode = false,
}: SessionTitleInput): string {
  const custom = customName?.trim()
  if (custom) return custom

  // A user-authored label, so it survives privacy mode.
  const claude = claudeName?.trim()
  if (claude) return claude

  if (!privacyMode) {
    const excerpt = firstUserMessage?.trim()
    if (excerpt) return excerpt
  }

  return fallback
}
