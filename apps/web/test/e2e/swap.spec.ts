import { expect, test } from "@playwright/test"

test.describe("Swap page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/swap")
  })

  test("renders the swap page with heading and token selectors", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /swap/i })).toBeVisible()
    // Two TokenSearch components, each with a "Select token" button trigger
    await expect(page.getByText("Select token").first()).toBeVisible()
    // Amount input with 0.0 placeholder
    await expect(page.getByPlaceholder("0.0").first()).toBeVisible()
  })

  test("amount input accepts numbers and strips non-numeric characters", async ({ page }) => {
    const amountInput = page.getByPlaceholder("0.0").first()
    await amountInput.fill("abc")
    await expect(amountInput).toHaveValue("")
    await amountInput.fill("1.5")
    await expect(amountInput).toHaveValue("1.5")
  })

  test("connect wallet button shown when not connected", async ({ page }) => {
    // Both the swap form and navbar show Connect Wallet when disconnected
    await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible()
  })

  test("slippage settings dropdown shows all options", async ({ page }) => {
    await page.getByLabel("Settings").click()
    await expect(page.getByRole("button", { name: "0.1%" })).toBeVisible()
    await expect(page.getByRole("button", { name: "0.5%" })).toBeVisible()
    await expect(page.getByRole("button", { name: "1.0%" })).toBeVisible()
  })
})
