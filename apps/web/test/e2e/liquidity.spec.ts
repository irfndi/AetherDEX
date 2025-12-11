import { test, expect } from '@playwright/test'

test.describe('Liquidity Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/trade/liquidity')
    })

    test('should display liquidity interface', async ({ page }) => {
        // Check heading (scope to main card area)
        const mainCard = page.locator('.glass-card').first()
        await expect(mainCard.getByText('Liquidity', { exact: true })).toBeVisible()

        // Check tabs exist (they're buttons with text inside the card)
        await expect(mainCard.getByText('Add', { exact: true })).toBeVisible()
        await expect(mainCard.getByText('Remove', { exact: true })).toBeVisible()
        await expect(mainCard.getByText('Positions', { exact: true })).toBeVisible()
    })

    test.skip('should switch between tabs', async ({ page }) => {
        const mainCard = page.locator('.glass-card').first()

        // Click Remove tab
        await mainCard.getByText('Remove', { exact: true }).click()
        await expect(page.getByText('Remove Amount')).toBeVisible()

        // Click Positions tab
        await mainCard.getByText('Positions', { exact: true }).click()
        await expect(page.getByText('No liquidity positions found')).toBeVisible()

        // Click Add tab
        await mainCard.getByText('Add', { exact: true }).click()
        await expect(page.getByText('Token A')).toBeVisible()
    })

    test('should show connect wallet button when not connected', async ({ page }) => {
        await expect(page.getByRole('button', { name: /Connect Wallet/i }).first()).toBeVisible()
    })
})

