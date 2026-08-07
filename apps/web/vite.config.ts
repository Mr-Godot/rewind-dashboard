import { defineConfig, type Plugin } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import { homedir, tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, unlinkSync, chmodSync } from 'node:fs'
import { resolveLaunchTarget } from './src/lib/launch/launch-session'
import { validateRequestOrigin } from './src/lib/launch/request-origin'
import { buildScript, SCRIPT_EXTENSIONS } from './src/lib/launch/terminal-registry'
import { detectTerminalsSync, getResolvedLauncher } from './src/lib/launch/terminal-detect'
import { readTerminalPreferenceSync, resolveRecipe } from './src/lib/launch/terminal-preference'
import type { TerminalPlatform } from './src/lib/launch/terminal-ids'

function currentTerminalPlatform(): TerminalPlatform {
  const p = platform()
  if (p === 'win32' || p === 'darwin') return p
  return 'linux'
}

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
        // Gate before a single byte of body is read: a rejected caller must
        // reach no parsing and no filesystem lookup.
        const originCheck = validateRequestOrigin(req.headers)
        if (!originCheck.ok) {
          res.writeHead(originCheck.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: originCheck.error }))
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            // All validation, the session-dir lookup and the dead-cwd guard live
            // in one tested module. A non-ok decision spawns NOTHING.
            const target = resolveLaunchTarget(body, homedir())
            if (!target.ok) {
              res.writeHead(target.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: target.error }))
              return
            }
            const { sessionId, sessionCwd } = target

            // Which terminal: an allowlisted ID from the body, else the saved
            // preference read fresh off disk. With no preference the answer is
            // 428, never a guess, so no request can obtain a defaulted spawn.
            const termPlatform = currentTerminalPlatform()
            const detection = detectTerminalsSync()
            const decision = resolveRecipe({
              bodyTerminalId: (body ?? {}).terminalId,
              saved: readTerminalPreferenceSync(termPlatform),
              detectedIds: detection.detected.map((d) => d.id),
              platform: termPlatform,
            })
            if (!decision.ok) {
              res.writeHead(decision.status, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: decision.error }))
              return
            }

            const { recipe } = decision
            const idPrefix = sessionId.slice(0, 8)
            // Window title makes the spawned terminal auditable: users can see
            // it belongs to Rewind instead of mistaking it for malware.
            const windowTitle = `Rewind Session ${idPrefix}`
            const scriptPath = join(
              tmpdir(),
              `launch-session-${idPrefix}${SCRIPT_EXTENSIONS[recipe.scriptFlavor]}`,
            )
            // The script self-deletes where the flavor allows it, which works
            // even if the Vite dev server has already shut down. The 60s
            // setTimeout below is a fallback for the cases where it cannot.
            writeFileSync(scriptPath, buildScript(recipe.scriptFlavor, { sessionId, sessionCwd, windowTitle }))
            if (platform() !== 'win32') chmodSync(scriptPath, 0o755)

            // Launcher paths discovered by a file probe (Git Bash) live only in
            // the detection cache, never in settings.json.
            const launcherPath = recipe.launcher ?? getResolvedLauncher(recipe.id)
            if (!launcherPath) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Terminal launcher could not be located' }))
              return
            }

            spawn(launcherPath, recipe.argv({ scriptPath, sessionCwd, windowTitle, launcherPath }), {
              detached: true,
              stdio: 'ignore',
            }).unref()
            setTimeout(() => { try { unlinkSync(scriptPath) } catch {} }, 60000)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify(
                decision.warning
                  ? { ok: true, warning: decision.warning, missing: decision.missing }
                  : { ok: true },
              ),
            )
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
  // keys its dev-vs-prod JSX runtime on process.env.NODE_ENV. If it is unset OR
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
