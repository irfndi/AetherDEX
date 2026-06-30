import { expect, test } from "@playwright/test"

test.describe("Visual QA", () => {
  test("swap page has no AI slop classes", async ({ page }) => {
    await page.goto("/swap")
    await page.waitForLoadState("networkidle")

    // Verify no AI slop: animate-float, glow-pulse, glass-card patterns
    const floatElements = await page.locator(".animate-float").count()
    const pulseElements = await page.locator(".glow-pulse").count()
    expect(floatElements).toBe(0)
    expect(pulseElements).toBe(0)

    // Capture screenshot for human review
    await page.screenshot({ path: "test-results/swap.png", fullPage: true })
  })

  test("pools page renders without AI slop", async ({ page }) => {
    await page.goto("/pools")
    await page.waitForLoadState("networkidle")

    const floatElements = await page.locator(".animate-float").count()
    const pulseElements = await page.locator(".glow-pulse").count()
    expect(floatElements).toBe(0)
    expect(pulseElements).toBe(0)

    await page.screenshot({ path: "test-results/pools.png", fullPage: true })
  })

  test("default theme is aetherdex (dark)", async ({ page }) => {
    await page.goto("/")
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"))
    expect(theme).toBe("aetherdex")
  })
})
