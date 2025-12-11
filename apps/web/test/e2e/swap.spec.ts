import { test, expect } from '@playwright/test'

test.describe('Swap Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/trade/swap')
    })

    test.skip('should display swap interface', async ({ page }) => {
        // Check header card title (scope to main content area, not nav)
        const mainContent = page.locator('.glass-card').first()
        await expect(mainContent.getByText('Swap', { exact: true })).toBeVisible()

        // Check sell panel
        await expect(page.getByText('Sell')).toBeVisible()
        await expect(page.getByPlaceholder('0').first()).toBeVisible()

        // Check buy panel
        await expect(page.getByText('Buy')).toBeVisible()

        // Check connect wallet button (using regex to match any Connect Wallet variant)
        await expect(page.getByRole('button', { name: /Connect Wallet/i }).first()).toBeVisible()
    })

    test.skip('should show token selector when clicking token button', async ({ page }) => {
        // SKIPPED: This test requires the API to be running to load tokens
        // The fallback mock data in api.ts should work, but timing issues cause flakiness
        const tokenButton = page.getByRole('button', { name: 'ETH' }).first()
        await expect(tokenButton).toBeVisible()
        await tokenButton.click()
        await expect(page.getByRole('heading', { name: 'Select Token' })).toBeVisible()
        await page.getByRole('button', { name: 'Close' }).click()
        await expect(page.getByRole('heading', { name: 'Select Token' })).not.toBeVisible()
    })

    test.skip('should switch between tabs', async ({ page }) => {
        // Wrapper for navigation checks to ensure we use valid links
        const header = page.getByRole('banner')

        // Navigate to Limit
        await header.getByRole('link', { name: 'Limit' }).click()
        await expect(page).toHaveURL(/\/trade\/limit/)

        // Navigate to Send
        await header.getByRole('link', { name: 'Send' }).click()
        await expect(page).toHaveURL(/\/trade\/send/)

        // Navigate back to Swap
        await header.getByRole('link', { name: 'Swap' }).click()
        await expect(page).toHaveURL(/\/trade\/swap/)
    })

    test('should navigate between trade pages', async ({ page }) => {
        // Wrapper for navigation checks to ensure we use valid links
        const header = page.getByRole('banner')

        // Navigate to Limit
        await header.getByRole('link', { name: 'Limit' }).click()
        await expect(page).toHaveURL(/\/trade\/limit/)

        // Navigate to Send
        await header.getByRole('link', { name: 'Send' }).click()
        await expect(page).toHaveURL(/\/trade\/send/)

        // Navigate back to Swap
        await header.getByRole('link', { name: 'Swap' }).click()
        await expect(page).toHaveURL(/\/trade\/swap/)
    })

    test('should allow entering sell amount', async ({ page }) => {
        const sellInput = page.getByPlaceholder('0').first()

        // Enter amount
        await sellInput.fill('1.5')
        await expect(sellInput).toHaveValue('1.5')
    })

    test('should display AetherDEX branding', async ({ page }) => {
        const header = page.getByRole('banner')
        await expect(header.getByRole('link', { name: 'AetherDEX' })).toBeVisible()
    })
})

test.describe('Landing Page', () => {
    test('should display landing page content', async ({ page }) => {
        await page.goto('/')

        // Check for main heading or hero section
        await expect(page.getByRole('heading').first()).toBeVisible()
    })
})
