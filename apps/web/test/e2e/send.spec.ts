import { test, expect } from '@playwright/test'

test.describe('Send Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/trade/send')
    })

    test('should display send interface', async ({ page }) => {
        // Check header
        await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible()

        // Check recipient input
        await expect(page.getByText('Recipient')).toBeVisible()
        await expect(page.getByPlaceholder('0x... or ENS name')).toBeVisible()

        // Check amount input
        await expect(page.getByText('Amount')).toBeVisible()
        await expect(page.getByPlaceholder('0').first()).toBeVisible()

        // Check connect wallet button (when not connected)
        // Check connect wallet button (when not connected)
        await expect(page.getByRole('button', { name: 'Connect Wallet to Send' })).toBeVisible()
    })

    test('should allow entering recipient and amount', async ({ page }) => {
        const recipientInput = page.getByPlaceholder('0x... or ENS name')
        const amountInput = page.getByPlaceholder('0').first()

        // Enter recipient
        await recipientInput.fill('0x1234567890123456789012345678901234567890')
        await expect(recipientInput).toHaveValue('0x1234567890123456789012345678901234567890')

        // Enter amount
        await amountInput.fill('1.5')
        await expect(amountInput).toHaveValue('1.5')
    })

    test('should navigate to other trade pages', async ({ page }) => {
        const header = page.getByRole('banner')

        // Navigate to Swap
        await header.getByRole('link', { name: 'Swap' }).click()
        await expect(page).toHaveURL(/\/trade\/swap/)

        // Navigate back to Send
        await header.getByRole('link', { name: 'Send' }).click()
        await expect(page).toHaveURL(/\/trade\/send/)

        // Navigate to Limit
        await header.getByRole('link', { name: 'Limit' }).click()
        await expect(page).toHaveURL(/\/trade\/limit/)
    })
})
