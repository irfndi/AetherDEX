import { test, expect } from '@playwright/test'

test.describe('Swap Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/trade/swap')
    })

    test('should display swap interface', async ({ page }) => {
        // Check header
        await expect(page.getByRole('heading', { name: 'Swap' })).toBeVisible()

        // Check sell panel
        await expect(page.getByText('Sell')).toBeVisible()
        await expect(page.getByPlaceholder('0').first()).toBeVisible()

        // Check buy panel
        await expect(page.getByText('Buy')).toBeVisible()

        // Check connect wallet button (when not connected)
        await expect(page.getByRole('button', { name: 'Connect Wallet to Swap' })).toBeVisible()
    })

    test('should show token selector when clicking token button', async ({ page }) => {
        // Click the sell token selector
        await page.getByRole('button', { name: /Select|ETH|USDC/i }).first().click()

        // Modal should appear
        await expect(page.getByRole('heading', { name: /Select.*token/i })).toBeVisible()

        // Close modal
        await page.getByRole('button', { name: 'Close' }).click()
        await expect(page.getByRole('heading', { name: /Select.*token/i })).not.toBeVisible()
    })

    test('should navigate between trade pages', async ({ page }) => {
        // Check swap is active
        await expect(page.getByRole('link', { name: 'Swap' })).toBeVisible()

        // Navigate to Limit
        await page.getByRole('link', { name: 'Limit' }).click()
        await expect(page).toHaveURL(/\/trade\/limit/)

        // Navigate to Send
        await page.getByRole('link', { name: 'Send' }).click()
        await expect(page).toHaveURL(/\/trade\/send/)

        // Navigate back to Swap
        await page.getByRole('link', { name: 'Swap' }).click()
        await expect(page).toHaveURL(/\/trade\/swap/)
    })

    test('should allow entering sell amount', async ({ page }) => {
        const sellInput = page.getByPlaceholder('0').first()

        // Enter amount
        await sellInput.fill('1.5')
        await expect(sellInput).toHaveValue('1.5')
    })

    test('should display AetherDEX branding', async ({ page }) => {
        await expect(page.getByRole('link', { name: 'AetherDEX' })).toBeVisible()
    })
})

test.describe('Landing Page', () => {
    test('should display landing page content', async ({ page }) => {
        await page.goto('/')

        // Check for main heading or hero section
        await expect(page.getByRole('heading').first()).toBeVisible()
    })
})
