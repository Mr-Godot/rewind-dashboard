import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('Given the app is loaded, When I visit the root URL, Then I am redirected to /dashboard', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('Given I am on sessions, When I click "Dashboard", Then I see the Dashboard page', async ({
    page,
  }) => {
    await page.goto('/sessions')
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('h1')).toContainText('Dashboard')
    await page.screenshot({
      path: 'e2e/screenshots/dashboard-page.png',
      fullPage: true,
    })
  })

  test('Given I am on sessions, When I click "Settings", Then I see the Settings page', async ({
    page,
  }) => {
    await page.goto('/sessions')
    await page.click('a[href="/settings"]')
    await expect(page).toHaveURL(/\/settings/)
    await expect(page.locator('h1')).toContainText('Settings')
    await page.screenshot({
      path: 'e2e/screenshots/settings-page.png',
      fullPage: true,
    })
  })

  test('Given I am on any page, Then the sidebar shows "Rewind Dashboard" branding', async ({
    page,
  }) => {
    await page.goto('/sessions')
    await expect(page.locator('aside')).toContainText('Rewind')
    await expect(page.locator('aside')).toContainText('Dashboard')
  })
})
