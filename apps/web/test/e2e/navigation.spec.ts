import { expect, test } from "@playwright/test"

test.describe("Navigation", () => {
  test("home redirects to swap", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/swap$/)
  })

  test("navbar links navigate between pages", async ({ page }) => {
    await page.goto("/swap")

    await page.getByRole("link", { name: "Pools" }).click()
    await expect(page).toHaveURL(/\/pools/)

    await page.getByRole("link", { name: "Portfolio" }).click()
    await expect(page).toHaveURL(/\/portfolio$/)
  })

  test("theme toggle switches between light and dark", async ({ page }) => {
    await page.goto("/swap")
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"))
    await page.getByLabel("Toggle theme").click()
    await page.waitForTimeout(200)
    const newTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"))
    expect(newTheme).not.toBe(initialTheme)
  })

  test("pools page renders heading, sort controls, and filter input", async ({ page }) => {
    await page.goto("/pools")
    await expect(page.getByRole("heading", { name: /pools/i })).toBeVisible()
    // Sort by buttons (TVL, Volume 24h, Fees 24h)
    await expect(page.getByRole("button", { name: "TVL" })).toBeVisible()
    // Filter input
    await expect(page.getByLabel(/filter by token/i)).toBeVisible()
  })

  test("portfolio page prompts to connect wallet", async ({ page }) => {
    await page.goto("/portfolio")
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible()
    await expect(page.getByText(/connect wallet/i)).toBeVisible()
  })
})
