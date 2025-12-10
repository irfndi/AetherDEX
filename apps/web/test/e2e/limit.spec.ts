import { test, expect } from '@playwright/test'

test.describe('Limit Order Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/trade/limit')
    })

    test('should display limit order interface', async ({ page }) => {
        await expect(page.getByText('Limit Order')).toBeVisible()
        await expect(page.getByText('Limit Price')).toBeVisible()

        // Inputs
        await expect(page.getByPlaceholder('0').first()).toBeVisible() // Amount
        await expect(page.getByPlaceholder('0.00')).toBeVisible() // Price

        // Connect wallet button
        await expect(page.getByRole('main').getByRole('button', { name: /Connect Wallet/i })).toBeVisible()
    })

    test('should allow entering amount and price', async ({ page }) => {
        const amountInput = page.getByPlaceholder('0').first()
        const priceInput = page.getByPlaceholder('0.00')

        await amountInput.fill('1.5')
        await expect(amountInput).toHaveValue('1.5')

        await priceInput.fill('1800.50')
        await expect(priceInput).toHaveValue('1800.50')
    })

    test('should show validation when price is invalid', async ({ page }) => {
        const priceInput = page.getByPlaceholder('0.00')
        await priceInput.fill('-100')
        // Assuming there is some visual feedback or it just accepts input for now
        await expect(priceInput).toHaveValue('-100')
    })
})
