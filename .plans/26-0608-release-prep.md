# 26-0608 public release prep

Repo: GodotH/rewind-dashboard. Goal: open-source-ready for release tomorrow.

## Done
- **LICENSE** — already MIT, `Copyright (c) 2026 Godot Huard` + upstream Dmytro Lupiak attribution. ✓ correct.
- **package.json** — added `"author": "Godot Huard"` (license/repo/homepage/keywords already present).
- **README** — already strong; enhanced:
  - per-OS Node.js install (`<details>` for Windows/macOS/Linux), Linux marked supported-but-lightly-tested
  - added `screenshots/rewind-dashboard.png` under Dashboard & Stats
  - simplified License section to `MIT © Godot Huard` (upstream named once, in Credits; full dual-copyright stays in LICENSE)
- **Screenshots** — regenerated clean from e2e fixtures (fake `/Users/test/...` data, dark matrix theme, real-path footer cropped). Replaced `rewind-sessions.png` (old one leaked real client names clinicAutism/magicDNA + `C:\Users\godot` paths) + added `rewind-dashboard.png`.
- **UI fix** — `SessionFilters.tsx` search placeholder rendered literal `⌘K`; now `⌘K`.
- Verified: tsc clean, 458 tests pass.

## Flagged (needs user decision — NOT changed)
- **Version inconsistency**: `package.json` = `1.3.0`, but `AppShell.tsx:63` hardcodes `v1.03` and CHANGELOG uses `v1.00..v1.03` (1.0.x scheme). Footer (app-info) shows `v1.3.0`. UI shows two versions at once. Pick one canonical version; then align AppShell (ideally read from app-info dynamically) + CHANGELOG + regenerate screenshot.
- **CHANGELOG** missing the recent ship-cleanup work (one-click launch, progressive loading, prod-build fix, e2e, hydration). Add an entry once version is decided.

## Pre-publish checklist (for the user)
- [ ] Decide version → make AppShell/CHANGELOG/package.json consistent
- [ ] Repo Settings → make public; confirm topics/description
- [ ] Optionally `npm publish` (bin `claude-dashboard` already configured)
