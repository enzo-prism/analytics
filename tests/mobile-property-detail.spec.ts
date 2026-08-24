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
  await expect(page.getByRole("heading", { name: "Prism" })).toBeVisible();
  await expect(page.getByTestId("property-stats")).toBeVisible();
  await expect(page.getByTestId("property-trend-chart")).toBeVisible();

  const chartBox = await page
    .getByTestId("property-trend-chart")
    .boundingBox();
  expect(chartBox?.height ?? 0).toBeGreaterThan(0);
});

test("property detail uses neutral raw values and semantic change tones", async ({
  page,
}) => {
  await page.route("**/api/properties/123?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(propertyFixture),
    });
  });

  await page.goto("/properties/123?window=d7");

  await expect(page.getByTestId("stat-current")).toHaveClass(/text-foreground/);
  await expect(page.getByTestId("stat-current")).not.toHaveClass(/text-positive/);
  await expect(page.getByTestId("stat-previous")).toHaveClass(
    /text-muted-foreground/,
  );
  await expect(page.getByTestId("stat-previous")).not.toHaveClass(/text-negative/);
  await expect(page.getByTestId("stat-delta")).toHaveClass(/text-positive/);
  await expect(page.getByTestId("stat-rate")).toHaveClass(/text-positive/);
  await expect(page.getByTestId("data-status")).toHaveClass(
    /text-muted-foreground/,
  );
  await expect(page.getByTestId("data-status")).not.toHaveClass(/text-positive/);

  const legend = page.getByTestId("trend-legend");
  await expect(legend).toBeVisible();
  await expect(legend.locator(".border-foreground")).toHaveCount(1);
  await expect(legend.locator(".border-dashed")).toHaveCount(1);

  await page.getByText("View accessible trend data").click();
  await expect(page.getByTestId("trend-current-heading")).toHaveClass(
    /text-foreground/,
  );
  await expect(page.getByTestId("trend-previous-heading")).toHaveClass(
    /text-muted-foreground/,
  );
  await expect(page.getByTestId("trend-current-value").first()).toHaveClass(
    /text-foreground/,
  );
  await expect(page.getByTestId("trend-previous-value").first()).toHaveClass(
    /text-muted-foreground/,
  );

  const chartLines = page.locator(".recharts-line-curve");
  await expect(chartLines).toHaveCount(2);
  await expect(chartLines.nth(0)).not.toHaveAttribute("stroke-dasharray");
  await expect(chartLines.nth(1)).toHaveAttribute("stroke-dasharray", "5 7");
});

test("negative detail changes and blocking errors use red", async ({ page }) => {
  await page.route("**/api/properties/123?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...propertyFixture,
        summary: { current: 43, previous: 100, delta: -57, pct: -0.57 },
      }),
    });
  });

  await page.goto("/properties/123?window=d7");
  await expect(page.getByTestId("stat-delta")).toHaveClass(/text-negative/);
  await expect(page.getByTestId("stat-rate")).toHaveClass(/text-negative/);

  await page.unroute("**/api/properties/123?**");
  await page.route("**/api/properties/404?**", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "403 forbidden" }),
    });
  });
  await page.goto("/properties/404?window=d7");
  await expect(page.getByTestId("data-status")).toHaveAttribute(
    "data-error-severity",
    "blocking",
  );
  await expect(page.getByTestId("data-status")).toHaveClass(/text-negative/);
  await expect(page.getByTestId("property-error")).toHaveClass(/text-negative/);
});

test("unavailable percentage stays muted", async ({ page }) => {
  await page.route("**/api/properties/123?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...propertyFixture,
        summary: { current: 20, previous: 0, delta: 20, pct: null },
      }),
    });
  });

  await page.goto("/properties/123?window=d7");
  await expect(page.getByTestId("stat-rate")).toHaveText("n/a");
  await expect(page.getByTestId("stat-rate")).toHaveClass(
    /text-muted-foreground/,
  );
  await expect(page.getByTestId("stat-rate")).toHaveAttribute(
    "data-trend-tone",
    "neutral",
  );
});
