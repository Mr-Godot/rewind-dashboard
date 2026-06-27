import { defineConfig, type Plugin } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn, execSync } from 'node:child_process'
import { homedir, tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { readdirSync, existsSync, writeFileSync, unlinkSync, chmodSync, openSync, readSync, closeSync } from 'node:fs'

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
            const { sessionId, cwd } = JSON.parse(Buffer.concat(chunks).toString())

            // Validate sessionId is a UUID to prevent command injection
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            if (!sessionId || typeof sessionId !== 'string' || !uuidRe.test(sessionId)) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid sessionId: must be a valid UUID' }))
              return
            }

            // Validate cwd if provided: must be absolute, no traversal, no shell metacharacters
            if (cwd != null) {
              if (typeof cwd !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Invalid cwd: must be a string' }))
                return
              }
              const isAbsolute = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('/')
              const hasTraversal = /(^|[\\/])\.\.($|[\\/])/.test(cwd)
              const shellMeta = /[;&|`$(){}!#*?<>\n\r]/.test(cwd)
              if (!isAbsolute || hasTraversal || shellMeta) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Invalid cwd: must be absolute path without traversal or shell metacharacters' }))
                return
              }
            }

            const home = homedir()
            const projDir = join(home, '.claude', 'projects')
            let sessionCwd = cwd || home
            try {
              const dirs = readdirSync(projDir)
              for (const d of dirs) {
                const jsonl = join(projDir, d, sessionId + '.jsonl')
                if (existsSync(jsonl)) {
                  const fd = openSync(jsonl, 'r')
                  const buf = Buffer.alloc(4096)
                  const bytesRead = readSync(fd, buf, 0, 4096, 0)
                  closeSync(fd)
                  const headLines = buf.toString('utf8', 0, bytesRead).split('\n')
                  for (const headLine of headLines) {
                    if (!headLine.trim()) continue
                    try {
                      const parsed = JSON.parse(headLine)
                      if (parsed.cwd) { sessionCwd = parsed.cwd; break }
                    } catch {}
                  }
                  if (sessionCwd !== (cwd || home)) break
                }
              }
            } catch {}
            const resumeCmd = `claude --resume ${sessionId} --dangerously-skip-permissions`
            const isWin = platform() === 'win32'
            let child
            if (isWin) {
              const safeCwd = sessionCwd.replace(/\//g, '\\')
              const idPrefix = sessionId.slice(0, 8)
              // Window title makes the spawned terminal auditable — users can see
              // it belongs to Rewind instead of mistaking it for malware.
              const windowTitle = `Rewind Session ${idPrefix}`
              const batPath = join(tmpdir(), `launch-session-${idPrefix}.bat`)
              // The .bat self-deletes on exit via `(goto) 2>nul & del "%~f0"`, which
              // works even if the Vite dev server has already shut down (the 60s
              // setTimeout below is a belt-and-suspenders fallback for edge cases
              // where the user kills the window before the claude process starts).
              const batLines = [
                '@echo off',
                `title ${windowTitle}`,
                `cd /d "${safeCwd}"`,
                resumeCmd,
                'pause',
                '(goto) 2>nul & del "%~f0"',
                '',
              ]
              writeFileSync(batPath, batLines.join('\r\n'))
              // First quoted argument to `start` is the window title — this ensures
              // the terminal is labeled even during the brief moment before the
              // .bat's own `title` command runs.
              child = spawn('cmd.exe', ['/c', 'start', windowTitle, batPath], { detached: true, stdio: 'ignore' })
              child.unref()
              setTimeout(() => { try { unlinkSync(batPath) } catch {} }, 60000)
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
