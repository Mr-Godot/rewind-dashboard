# Changelog

## v1.5.0

### Added
- **Real conversation search** — replaced the substring scan with a ranked SQLite FTS5 index (BM25 + snippets) that searches message text, tool calls, tool results, and thinking blocks, not just message text. Falls back to the simple scan when the native module is unavailable (#59)
- **Persistent filters** — sort, status, starred, view, and project filters now survive navigating away and back; explicit URL params still override (#60)
- **Hidden projects, surfaced** — the Sessions page shows a "N sessions in M projects hidden" banner with one-click unhide and a hidden-aware empty state, plus a **rescan** button to force a fresh scan when things look stale

### Fixed
- **Sessions silently missing** — project hide/pin is now keyed by the stable encoded directory name instead of a lossy decoded path, so new or path-colliding projects can no longer be auto-hidden; a one-time migration remaps legacy keys, drops orphaned keys and the `C:/` landmine, and resolves contradictory pinned+hidden state (#63)
- **Accidental whole-project hide** — the per-card "hide" button (which silently hid an entire project in one click) now reads as a project action and offers undo
- **Wrong counts** — message counts and token totals were extrapolated from 30 sampled lines; they are now exact via a single full pass, which also fixes the "most active" sort (#64)
- **Active detection** — no longer treats the persistent `subagents/` directory as a liveness lock (#29)
- **Render crashes** — hardened the production JSX build against an inherited `NODE_ENV=development` (`jsxDEV is not a function`), and removed a client-side `os.homedir()` crash that broke the Sessions page
- **Faster, un-stuck scans** — concurrent pollers now coalesce onto a single in-flight scan instead of overlapping cold scans
- **Tests no longer touch real data** — the disk-cache test sandboxes the cache directory instead of deleting `~/.claude-dashboard/cache`

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
