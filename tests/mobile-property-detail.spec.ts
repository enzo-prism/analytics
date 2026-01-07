import { expect, test } from "@playwright/test";

const propertyFixture = {
  updatedAt: "2026-01-07T00:00:00Z",
  window: "d7",
  property: {
    propertyId: "123",
    displayName: "Prism",
    defaultUri: "https://www.design-prism.com",
    emoji: "🧭",
  },
  summary: { current: 263, previous: 225, delta: 38, pct: 0.1688 },
  series: [
    { date: "2026-01-01", current: 30, previous: 25 },
    { date: "2026-01-02", current: 44, previous: 32 },
    { date: "2026-01-03", current: 35, previous: 30 },
    { date: "2026-01-04", current: 29, previous: 27 },
    { date: "2026-01-05", current: 38, previous: 35 },
    { date: "2026-01-06", current: 42, previous: 36 },
    { date: "2026-01-07", current: 45, previous: 40 },
  ],
  error: null,
};

test.use({ viewport: { width: 390, height: 844 } });

test("mobile property detail shows stats and chart", async ({ page }) => {
  await page.route("**/api/properties/123?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(propertyFixture),
    });
  });

  await page.goto("/properties/123?window=d7");
  await expect(page.getByText("Prism")).toBeVisible();
  await expect(page.getByTestId("property-stats")).toBeVisible();
  await expect(page.getByTestId("property-trend-chart")).toBeVisible();

  const chartBox = await page
    .getByTestId("property-trend-chart")
    .boundingBox();
  expect(chartBox?.height ?? 0).toBeGreaterThan(0);
});
