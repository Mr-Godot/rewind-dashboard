import { defineConfig, type Plugin } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn, execSync } from 'node:child_process'
import { homedir, tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, unlinkSync, chmodSync } from 'node:fs'
import { resolveLaunchTarget } from './src/lib/launch/launch-session'
import { buildLaunchScript, buildPowerShellArgs, resolvePowerShellExe } from './src/lib/launch/powershell-launch'

function launchSessionPlugin(): Plugin {
  return {
    name: 'launch-session',
    configureServer(server) {
      server.middlewares.use('/api/launch-session', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('Method not allowed')
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            // All validation, the session-dir lookup and the dead-cwd guard live
            // in one tested module. A non-ok decision spawns NOTHING.
            const target = resolveLaunchTarget(JSON.parse(Buffer.concat(chunks).toString()), homedir())
            if (!target.ok) {
              res.writeHead(target.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: target.error }))
              return
            }
            const { sessionId, sessionCwd } = target

            const resumeCmd = `claude --resume ${sessionId} --dangerously-skip-permissions`
            const isWin = platform() === 'win32'
            let child
            if (isWin) {
              const idPrefix = sessionId.slice(0, 8)
              // Window title makes the spawned terminal auditable — users can see
              // it belongs to Rewind instead of mistaking it for malware.
              const windowTitle = `Rewind Session ${idPrefix}`
              const ps1Path = join(tmpdir(), `launch-session-${idPrefix}.ps1`)
              // The .ps1 self-deletes on its last line, which works even if the
              // Vite dev server has already shut down (the 60s setTimeout below is
              // a belt-and-suspenders fallback for edge cases where the user kills
              // the window before the claude process starts).
              writeFileSync(ps1Path, buildLaunchScript({ sessionId, sessionCwd, windowTitle }))
              // `start` is only a launcher: it opens a NEW VISIBLE console hosting
              // PowerShell and exits immediately, so claude itself runs under
              // PowerShell. Its first quoted argument is the window title, which
              // labels the terminal during the brief moment before the .ps1 sets it.
              child = spawn(
                'cmd.exe',
                ['/c', 'start', windowTitle, resolvePowerShellExe(), ...buildPowerShellArgs(ps1Path)],
                { detached: true, stdio: 'ignore' },
              )
              child.unref()
              setTimeout(() => { try { unlinkSync(ps1Path) } catch {} }, 60000)
            } else if (platform() === 'darwin') {
              // macOS: write a .command script and open it in the user's default
              // terminal. Avoids hand-rolled osascript escaping (which broke cwd
              // paths containing spaces) and the AppleScript automation prompt.
              // `-l` login shell + `exec "$SHELL"` load the user's PATH (so
              // `claude` resolves) and keep the window open after exit.
              const cmdPath = join(tmpdir(), `launch-session-${sessionId.slice(0, 8)}.command`)
              const lines = [
                '#!/bin/bash -l',
                `cd "${sessionCwd}"`,
                resumeCmd,
                'exec "$SHELL"',
                '',
              ]
              writeFileSync(cmdPath, lines.join('\n'))
              chmodSync(cmdPath, 0o755)
              spawn('open', [cmdPath], { detached: true, stdio: 'ignore' }).unref()
              setTimeout(() => { try { unlinkSync(cmdPath) } catch {} }, 60000)
            } else {
              // Linux: write a shell script that sources profile for PATH
              const shPath = join(tmpdir(), `launch-session-${sessionId.slice(0,8)}.sh`)
              const lines = [
                '#!/usr/bin/env bash',
                '[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"',
                '[ -f "$HOME/.profile" ] && source "$HOME/.profile"',
                `cd "${sessionCwd}"`,
                resumeCmd,
                'exec bash',
                '',
              ]
              writeFileSync(shPath, lines.join('\n'))
              chmodSync(shPath, 0o755)
              // Find a terminal emulator (use execSync from top-level import)
              let term = 'xterm'
              for (const t of ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal']) {
                try {
                  if (execSync(`command -v ${t} 2>/dev/null`).toString().trim()) { term = t; break }
                } catch (_) { /* not found, try next */ }
              }
              if (term === 'gnome-terminal') {
                spawn(term, ['--', shPath], { detached: true, stdio: 'ignore' }).unref()
              } else {
                spawn(term, ['-e', shPath], { detached: true, stdio: 'ignore' }).unref()
              }
              setTimeout(() => { try { unlinkSync(shPath) } catch {} }, 60000)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Bad request'
            console.error('[launch-session] Error:', message)
            res.writeHead(400)
            res.end(JSON.stringify({ error: message }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  // Production builds must use React's production JSX transform. @vitejs/plugin-react
  // keys its dev-vs-prod JSX runtime on process.env.NODE_ENV — if it is unset OR
  // inherited as "development" from the shell, the SSR bundle emits `jsxDEV` and the
  // built server crashes at runtime ("jsxDEV is not a function"). `vite build` is a
  // production build by default, so force NODE_ENV=production for any non-development
  // build mode, overriding a stray ambient value (respect an explicit --mode development).
  if (command === 'build' && mode !== 'development') {
    process.env.NODE_ENV = 'production'
  }
  return {
    server: {
      port: 3000,
      watch: {
        ignored: ['**/routeTree.gen.ts'],
      },
    },
    // better-sqlite3 is an optional native addon loaded via createRequire on the
    // server only. Mark it external so Vite never tries to bundle the .node file.
    ssr: {
      external: ['better-sqlite3'],
    },
    plugins: [
      launchSessionPlugin(),
      tsConfigPaths(),
      tanstackStart(),
      viteReact(),
      tailwindcss(),
    ],
    // Test config is in vitest.config.ts (separate from app config to avoid
    // tanstackStart/viteReact plugins interfering with React module resolution in tests)
  }
})
