import { test, expect } from '@playwright/test'

// The former /stats route now redirects to /dashboard, which hosts the stats
// summary cards (Sessions / Messages / Tokens / Cost) and the charts.
test.describe('Stats (Dashboard)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stats')
    // /stats redirects to /dashboard; wait for a chart that only renders once
    // stats have loaded.
    await page.waitForSelector('text=Model Usage', { timeout: 15_000 })
  })

  test('Given stats-cache.json exists in fixtures, When I visit the dashboard, Then I see summary cards', async ({
    page,
  }) => {
    const main = page.locator('main')
    await expect(main.getByText('Sessions').first()).toBeVisible()
    await expect(main.getByText('Messages').first()).toBeVisible()
    await expect(main.getByText('Tokens').first()).toBeVisible()
    await expect(main.getByText('Cost').first()).toBeVisible()
    await page.screenshot({
      path: 'e2e/screenshots/stats-overview.png',
      fullPage: true,
    })
  })

  test('Given stats data exists, Then the Sessions card shows "3" total sessions', async ({
    page,
  }) => {
    // The Sessions summary card links to /sessions and shows the total (3).
    const sessionsCard = page
      .locator('main a[href="/sessions"]')
      .filter({ hasText: 'Sessions' })
      .first()
    await expect(sessionsCard).toContainText('3')
  })

  test('Given stats data exists, Then I see the Daily Activity chart rendered', async ({
    page,
  }) => {
    await expect(page.getByText('Daily Activity').first()).toBeVisible()
  })

  test('Given stats data exists, Then I see the Model Usage chart rendered', async ({
    page,
  }) => {
    await expect(page.getByText('Model Usage').first()).toBeVisible()
  })

  test('Given I navigate to /projects, Then I see the Projects analytics view', async ({
    page,
  }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/projects/)

    // Wait for project analytics to load
    await expect(page.getByText('Total Projects').first()).toBeVisible()
    await page.screenshot({
      path: 'e2e/screenshots/projects-page.png',
      fullPage: true,
    })
  })
})
