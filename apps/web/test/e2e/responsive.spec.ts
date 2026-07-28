import { expect, test } from "./fixtures"

const routes = ["/swap", "/pools", "/pools/new", "/positions", "/portfolio"]

test.describe("Responsive route shell", () => {
  test.use({ viewport: { width: 375, height: 667 } })

  for (const route of routes) {
    test(`${route} fits a narrow viewport`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator("main")).toBeVisible()
      await page.waitForLoadState("networkidle")

      const dimensions = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }))
      expect(dimensions.bodyWidth, `${route} overflows horizontally`).toBeLessThanOrEqual(dimensions.viewportWidth)
    })
  }
})
