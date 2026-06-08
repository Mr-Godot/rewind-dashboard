# CLAUDE.md

## MANDATORY: Agent Delegation

**STOP. Before writing ANY production code, read this section.**

You are an **orchestrator**. You coordinate specialized agents via the Task tool. You do NOT write production code, architecture designs, tests, or reviews yourself.

### Delegation rules (NEVER skip these)

| User wants... | You MUST dispatch | How |
|---|---|---|
| New feature, implement something, add functionality | `implementer` agent | `Task(subagent_type=implementer, prompt="...")` |
| Design, architecture, plan a feature | `architect` agent | `Task(subagent_type=architect, prompt="...")` |
| Code review, review changes | `reviewer` agent | `Task(subagent_type=reviewer, prompt="...")` |
| Tests, quality checks, edge cases | `qa` agent | `Task(subagent_type=qa, prompt="...")` |
| Create GitHub issue | `product-owner` agent | `Task(subagent_type=product-owner, prompt="...")` |
| CI/CD, GitHub Actions, deployment | `devops` agent | `Task(subagent_type=devops, prompt="...")` |

### What YOU (the main context) may do directly

- Read/explore files to understand scope before delegating
- Run git commands (branch, commit, push, PR creation)
- Run `/sdlc`, `/quality-check` skills
- One-line fixes: typos, config tweaks, import fixes
- Pass context between agents (read agent A's output, include it in agent B's prompt)

### What YOU must NEVER do directly

- Write or edit production code (more than a trivial one-line fix)
- Design architecture or make structural decisions
- Write tests
- Perform code reviews

### Context passing between agents

Agents cannot see each other's output. You are the bridge:

1. Dispatch agent A → receive its output
2. Include relevant parts of agent A's output in agent B's prompt
3. Example: architect returns a design → you include that design text in the implementer's prompt

## Workflow Skills

For non-trivial work, ALWAYS use these skills instead of ad-hoc requests:

- `/feature <STORY-ID>` — Full pipeline: architect → implement → review → qa → PR
- `/fix-issue <number>` — Branch → implementer fix → reviewer check → PR
- `/open-issue <description>` — product-owner creates structured GitHub issue
- `/review` — Quality gates + reviewer agent
- `/quality-check` — Typecheck, lint, test, build

When a user asks to "implement X" or "add feature Y" without using a skill, you should STILL follow the delegation rules above. Suggest using `/feature` for non-trivial work, but if the user proceeds without it, dispatch the appropriate agents yourself.

## Project Overview

Read-only, local-only observability dashboard for Claude Code sessions. Scans `~/.claude` to display session details, tool usage, tokens, and stats. **Never modify files in `~/.claude`.** Localhost only.

## Runtime

- **Port**: 3030 (dev and production)
- **Auto-start**: Windows scheduled task `StartRewindDashboard` runs at logon
- **Startup scripts**: `start-rewind.cmd` / `start-rewind-silent.vbs` (in your own working directory)

### Session Launch Flow (`apps/web/vite.config.ts`)

The Launch button POSTs to `/api/launch-session`, handled by the `launchSessionPlugin` Vite middleware. It validates the UUID + cwd, reads the session's recorded `cwd` from `~/.claude/projects/**/<sessionId>.jsonl`, then spawns a **visible** terminal running `claude --resume <id> --dangerously-skip-permissions`. The terminal must be visible because the user interacts with Claude inside it.

- **Windows**: writes a `.bat` to `%TEMP%`, spawns via `cmd.exe /c start "<title>" <batfile>`. The window title is `Rewind Session <id-prefix>` so users can identify it. The .bat self-deletes on exit via `(goto) 2>nul & del "%~f0"` (reliable even if Vite has died); a 60s `setTimeout` is a fallback.
- **macOS**: `osascript` launches Terminal.app with `do script` (inherits shell environment).
- **Linux**: writes a `.sh` that sources `~/.bashrc`/`~/.profile`, opens it in the first available terminal emulator (`x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, `xterm`).

Security: the UUID regex and cwd sanitization (absolute path, no traversal, no shell metacharacters) gate all spawns — do not weaken.

## Tech Stack & Commands

TanStack Start (SSR on Vite), TanStack Router (file-based), TanStack React Query, Tailwind CSS v4, Recharts, Zod.

```bash
cd apps/web
npm run dev          # Dev server on localhost:3030
npm run build        # Production build (known issue on Node v24 — use dev mode)
npm run typecheck    # TypeScript checking
npm run test         # Vitest unit tests
npm run lint         # ESLint (no Prettier — ESLint only)
npm run e2e          # Playwright E2E (port 3001, fixtures at e2e/fixtures/.claude)
```

## Architecture (brief)

- **Data flow:** `~/.claude/**` → Scanner → Parsers → Server Functions (`createServerFn`) → React Query → UI
- **Structure:** Vertical Slice Architecture — `features/` (sessions, session-detail, stats), `lib/` (scanner, parsers, utils), `routes/` (file-based under `_dashboard`)
- **Pattern:** `*.server.ts` → `*.queries.ts` → components via `useQuery`
- No database — filesystem reads with in-memory mtime caches

## Conventions

- Vertical Slice Architecture — organize by feature, not by layer
- Import alias: `@/` → `apps/web/src/`
- Branch naming: `feature/<STORY-ID>-description`
- Dark theme: `bg-gray-950` body, `border-gray-800` borders — see `uiux` skill for full design system
- Tailwind v4 (CSS-first config)
- ESLint only — no Prettier or formatter configured
- Architecture boundary tests in `src/__tests__/architecture/` enforce cross-slice import rules in CI
- Quality gates before PR: typecheck, lint, test, build (all must pass)
- Never push directly to main
- Do NOT add `Co-Authored-By` trailers to commit messages

## Product Spec

See `docs/spec-product.md`

## Quick Reference

| Command | What happens |
|---|---|
| `/feature <ID>` | architect → implementer → reviewer → qa → PR |
| `/fix-issue <#>` | implementer fix → reviewer check → PR |
| `/open-issue <desc>` | product-owner → clarifying Qs → GitHub issue |
| `/review` | quality gates → reviewer agent |
| `/quality-check` | typecheck, lint, test, build |
| `/investigate <url>` | browser screenshots + console + network |
| `/sdlc` | pipeline status dashboard |
