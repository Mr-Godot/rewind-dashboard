import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesRoot = path.resolve(__dirname, '..', 'fixtures')
const projectDir = path.join(fixturesRoot, '.claude', 'projects', '-Users-test-projects-vault')
const metadataFile = path.join(fixturesRoot, '.claude-dashboard', 'session-metadata.json')

const HIDDEN_PROJECT = '-Users-test-projects-vault'
const RENAMED = 'session-901'
const INFIXED = 'session-902'

/**
 * The user's reported bug, end to end: sessions in a hidden project were
 * unreachable by ANY search, and the matcher could not see past a separator.
 * The fixture lives only for this file: the project is hidden, so it is
 * invisible to every other spec's default list.
 */
function line(uuid: string, ts: string, text: string) {
  return JSON.stringify({
    type: 'user',
    uuid,
    timestamp: ts,
    cwd: '/Users/test/projects/vault',
    gitBranch: 'main',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

test.beforeAll(() => {
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(
    path.join(projectDir, `${RENAMED}.jsonl`),
    line('u-901', '2025-06-15T14:00:00Z', 'unrelated conversation body') + '\n',
    'utf-8',
  )
  fs.writeFileSync(
    path.join(projectDir, `${INFIXED}.jsonl`),
    line('u-902', '2025-06-16T14:00:00Z', 'another unrelated body') + '\n',
    'utf-8',
  )

  fs.mkdirSync(path.dirname(metadataFile), { recursive: true })
  let existing: { version: number; sessions: Record<string, unknown>; projects: Record<string, unknown> } = {
    version: 2,
    sessions: {},
    projects: {},
  }
  try {
    existing = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'))
  } catch {
    // First run in this fixture tree.
  }
  existing.sessions = {
    ...existing.sessions,
    [RENAMED]: { customName: 'orbit-crm-v2' },
    [INFIXED]: { customName: 'agent-brain' },
  }
  existing.projects = { ...existing.projects, [HIDDEN_PROJECT]: { hidden: true } }
  fs.writeFileSync(metadataFile, JSON.stringify(existing, null, 2), 'utf-8')
})

test.afterAll(() => {
  fs.rmSync(projectDir, { recursive: true, force: true })
  try {
    const existing = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'))
    delete existing.sessions?.[RENAMED]
    delete existing.sessions?.[INFIXED]
    delete existing.projects?.[HIDDEN_PROJECT]
    fs.writeFileSync(metadataFile, JSON.stringify(existing, null, 2), 'utf-8')
  } catch {
    // Nothing to clean up.
  }
})

test.describe('Search reaches renamed sessions in hidden projects', () => {
  test('Given a hidden project, When I search "orbit crm", Then the renamed session appears with a hidden chip', async ({
    page,
  }) => {
    await page.goto('/sessions')
    await page.waitForSelector('a[href*="/sessions/"]', { timeout: 15_000 })

    await page.locator('input[placeholder*="Search"]').fill('orbit crm')

    const card = page.locator(`a[href*="/sessions/${RENAMED}"]`)
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText('hidden project')).toBeVisible()
  })

  test('Given a hidden project, When I search "brain", Then the infix-named session appears in the LIST', async ({
    page,
  }) => {
    await page.goto('/sessions')
    await page.waitForSelector('a[href*="/sessions/"]', { timeout: 15_000 })

    await page.locator('input[placeholder*="Search"]').fill('brain')

    const card = page.locator(`[data-testid="session-list-rows"] a[href*="/sessions/${INFIXED}"]`)
    await expect(card).toBeVisible({ timeout: 15_000 })
  })

  test('Given an empty query, When the list loads, Then the hidden project stays hidden', async ({
    page,
  }) => {
    await page.goto('/sessions')
    await page.waitForSelector('a[href*="/sessions/"]', { timeout: 15_000 })

    await expect(page.locator(`a[href*="/sessions/${RENAMED}"]`)).toHaveCount(0)
  })
})
