# Changelog

## v1.4.0

### Added
- **One-click launch** — resuming a session now launches immediately (removed the confirmation popup)
- **Progressive session loading** — the first page renders fast and the next page is prefetched in the background; the session summary cache now persists to disk so cold starts stay quick even with thousands of sessions

### Fixed
- **Production build** — fixed the production SSR crash (`jsxDEV is not a function`); `npm run build` + `npm start` now serve correctly
- **Graceful missing sessions** — opening a deleted or rotated session shows a friendly "this session no longer exists" state instead of a raw error, and removes the stale card from the list
- **Terminal loader alignment** — the first-load loader is left-aligned with the rest of the page (no more centered "swing")
- **Hydration warning** — silenced the theme-script hydration mismatch and removed render-purity issues (`Date.now()` / refs during render)
- **macOS launch** — fixed Terminal escaping so session paths containing spaces work
- **Search placeholder** — the `⌘K` shortcut hint now renders correctly

### Internal
- E2E suite updated for the current dashboard navigation; unit + E2E suites green in CI

## v1.03

### Added
- **Dashboard overhaul** — 4-tab navigation (Dashboard, Sessions, Projects, Settings), unified stat box grid
- **Active session detection** — dual-strategy: lock directory (15min) + mtime-only (2min) for newer Claude Code versions
- **Conversation viewer** — full chat history on session detail page
- **Full-text conversation search** — searches inside all messages, shows matching snippets
- **Project badges** — clickable project labels on every session card
- **Launch confirmation popup** — shows session details before resuming
- **Matrix green theme** — emerald accents, loading animation, sidebar redesign

### Fixed
- **Path decoding** — Windows hyphens preserved, macOS homedir-matching heuristic for lossy encoding
- **Token counting** — fixed double-counting for sessions with < 30 lines (head/tail overlap)
- **Session launch** — reads `cwd` from JSONL data instead of lossy decoded path
- **Stream cleanup** — proper `try/finally` on readline streams to prevent resource leaks
- **Security** — UUID validation on sessionId, path traversal checks on cwd, removed `--dangerously-skip-permissions`

## v1.02

### Added
- **Renamable projects** — give projects meaningful names from the Projects page
- **Full-text search** — 3+ character queries search inside conversations
- **Search timestamps** — matching snippets show message timestamps
- **Collapsible agent sections** — tool call details collapse for readability

## v1.01

### Added
- **Sort modes** — latest, most messages, longest, largest, starred only
- **Grouped project view** — sessions under collapsible project headers
- **Projects route** — dedicated page for managing projects
- **Cross-platform launcher** — Windows, macOS (Terminal.app), Linux (gnome-terminal/konsole/xterm)

## v1.00

### Added
- Initial release — fork of claude-session-dashboard with session management, starring, renaming, and launching
