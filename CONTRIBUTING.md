# Contributing to Rewind Dashboard

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/GodotH/rewind-dashboard.git
cd rewind-dashboard/apps/web
npm install
npx vite --port 3030
```

The dev server reads session data from `~/.claude` (read-only).

## Project Structure

Vertical Slice Architecture — code organized by feature, not by layer:

```
apps/web/src/
  routes/          # File-based routes (TanStack Router)
  features/        # Feature slices (sessions, stats, settings, etc.)
  lib/             # Scanner, parsers, cache, utilities
  components/      # Shared UI components
```

Each feature slice contains its own server functions, queries, and UI components.

## Development Commands

```bash
npx vite --port 3030     # Dev server
npx vitest               # Unit tests
```

## Making Changes

1. Fork the repo and create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `npx vitest`
4. Commit with a descriptive message
5. Open a Pull Request

## Conventions

- **TypeScript** — no `any`, use Zod for runtime validation
- **Tailwind CSS v4** — utility-first, CSS-first configuration
- **TanStack Query** — all data fetching through React Query hooks
- **Named exports** — prefer named over default exports
- **Dark theme** — `bg-gray-950` body, `border-gray-800` borders, emerald accents

## Questions?

Open an [issue](https://github.com/GodotH/rewind-dashboard/issues).
