import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'e2e', 'fixtures', '.claude')
// Sanity net: CLAUDE_HOME drives both the scanner and the dashboard's writable
// state (getDashboardDir), so every cache/metadata/settings write lands in
// e2e/fixtures/.claude-dashboard, never the real ~/.claude-dashboard.
const dashboardDir = path.join(path.dirname(fixturesDir), '.claude-dashboard')

// Fail fast rather than let a run prune the user's real search index / metadata.
if (dashboardDir.startsWith(path.join(os.homedir(), '.claude-dashboard'))) {
  throw new Error(
    `Refusing to run e2e: derived dashboard dir "${dashboardDir}" collides with the real ~/.claude-dashboard`,
  )
}

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3001',
    port: 3001,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      CLAUDE_HOME: fixturesDir,
    },
  },
})
