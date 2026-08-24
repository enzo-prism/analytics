import { expect, test } from "@playwright/test";
import { classifyTrend } from "../src/lib/trend";

const dashboardFixture = {
  updatedAt: "2026-01-07T00:00:00Z",
  window: "d7",
  properties: [
    {
      propertyId: "456",
      displayName: "Olympic Bootworks Website",
      defaultUri: "https://www.olympicbootworks.com",
      emoji: "🚴",
      newUsers: { current: 909, previous: 820, delta: 89, pct: 0.1085 },
      error: null,
    },
    {
      propertyId: "123",
      displayName: "Prism",
      defaultUri: "https://www.design-prism.com",
      emoji: "🧭",
      newUsers: { current: 263, previous: 225, delta: 38, pct: 0.1688 },
      error: null,
    },
    {
      propertyId: "789",
      displayName: "Canary Cove",
      defaultUri: "https://www.canarycove.com",
      emoji: "🌊",
      newUsers: { current: 43, previous: 299, delta: -256, pct: -0.8562 },
      error: null,
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      propertyId: String(1000 + index),
      displayName: `Portfolio Site ${index + 1}`,
      defaultUri: `https://site-${index + 1}.example.com`,
      emoji: "🌐",
      newUsers: {
        current: 200 - index,
        previous: 180 - index,
        delta: 20,
        pct: 0.1,
      },
      error: null,
    })),
  ],
};

test.use({ viewport: { width: 390, height: 844 } });

test("trend tones use normalized rate and impact gates", () => {
  const windowDays = {
    d1: 1,
    d7: 7,
    d28: 28,
    d90: 90,
    d180: 180,
    d365: 365,
  } as const;

  for (const [windowKey, days] of Object.entries(windowDays)) {
    const scale = days / 7;
    const previous = 100 * scale;

    expect(
      classifyTrend(
        {
          current: previous + 10 * scale,
          previous,
          delta: 10 * scale,
          pct: 0.15,
        },
        windowKey as keyof typeof windowDays,
      ),
    ).toBe("positive");
    expect(
      classifyTrend(
        {
          current: previous - 10 * scale,
          previous,
          delta: -10 * scale,
          pct: -0.2,
        },
        windowKey as keyof typeof windowDays,
      ),
    ).toBe("negative");
    expect(
      classifyTrend(
        {
          current: previous - 20 * scale,
          previous,
          delta: -20 * scale,
          pct: -0.4,
        },
        windowKey as keyof typeof windowDays,
      ),
    ).toBe("critical");
  }

  expect(
    classifyTrend(
      { current: 110, previous: 100, delta: 10, pct: 0.15 },
      "d7",
    ),
  ).toBe("positive");
  expect(
    classifyTrend(
      { current: 109, previous: 100, delta: 9, pct: 0.2 },
      "d7",
    ),
  ).toBe("neutral");
  expect(
    classifyTrend(
      { current: 90, previous: 100, delta: -10, pct: -0.2 },
      "d7",
    ),
  ).toBe("negative");
  expect(
    classifyTrend(
      { current: 80, previous: 100, delta: -20, pct: -0.4 },
      "d7",
    ),
  ).toBe("critical");
  expect(
    classifyTrend(
      { current: 0, previous: 10, delta: -10, pct: null },
      "d7",
    ),
  ).toBe("critical");
  expect(
    classifyTrend(
      { current: 0, previous: 9, delta: -9, pct: null },
      "d7",
    ),
  ).toBe("neutral");
  expect(
    classifyTrend(
      { current: 360, previous: 400, delta: -40, pct: -0.2 },
      "d28",
    ),
  ).toBe("negative");
  expect(
    classifyTrend(
      { current: 320, previous: 400, delta: -80, pct: -0.4 },
      "d28",
    ),
  ).toBe("critical");
});

test("mobile dashboard uses card layout without horizontal scroll", async ({
  page,
}) => {
  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboardFixture),
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Analytics dashboard" }),
  ).toHaveCount(1);
  await expect(page.getByText("New Users", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Google Analytics portfolio", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/^Updated /)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Portfolio summary" }),
  ).toHaveCount(0);
  await expect(page.getByText("Total new users", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Growing properties", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Declining properties", { exact: true })).toHaveCount(0);
  await expect(page.getByText("All sources reporting", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("property-cards")).toBeVisible();
  await expect(page.getByTestId("property-card")).toHaveCount(
    dashboardFixture.properties.length,
  );

  const refreshButton = page.getByRole("button", {
    name: "Refresh analytics data",
  });
  const reportingWindow = page.getByLabel("Reporting window");
  const statusFilter = page.getByLabel("Filter by status");
  const priorityLink = page.getByRole("link", {
    name: "Review Canary Cove priority signal",
  });
  const firstCard = page.getByTestId("property-card").first();

  for (const control of [refreshButton, reportingWindow, statusFilter]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const priorityBox = await priorityLink.boundingBox();
  expect(priorityBox?.height).toBeGreaterThanOrEqual(44);
  expect(priorityBox?.height).toBeLessThanOrEqual(96);

  const firstCardBox = await firstCard.boundingBox();
  expect(firstCardBox?.height).toBeLessThanOrEqual(168);
  expect(firstCardBox?.x).toBeGreaterThanOrEqual(16);
  expect(firstCardBox?.width).toBeLessThanOrEqual(358);
  expect(firstCardBox?.y).toBeLessThan(360);

  const firstHeadingWhiteSpace = await firstCard
    .getByRole("heading")
    .evaluate((element) => getComputedStyle(element).whiteSpace);
  expect(firstHeadingWhiteSpace).not.toBe("nowrap");

  for (const property of dashboardFixture.properties) {
    await expect(
      page.getByRole("heading", { name: property.displayName, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("navigation", { name: "Property pages" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Previous property page")).toHaveCount(0);
  await expect(page.getByLabel("Next property page")).toHaveCount(0);
  await expect(
    page.getByTestId("property-card").first().getByText("New users · 7d"),
  ).toBeVisible();

  await page.getByTestId("property-card").last().scrollIntoViewIfNeeded();

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBeFalsy();
});

test("property cards keep only the essential analytics content", async ({
  page,
}) => {
  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboardFixture),
    });
  });

  await page.goto("/");
  const firstCard = page.getByTestId("property-card").first();

  await expect(
    page.getByRole("link", {
      name: "Open Olympic Bootworks Website analytics",
      exact: true,
    }),
  ).toBeVisible();
  await expect(firstCard.getByText("Olympic Bootworks Website")).toBeVisible();
  await expect(firstCard.getByText("New users · 7d")).toBeVisible();
  await expect(firstCard.getByText("909", { exact: true })).toBeVisible();
  await expect(firstCard.getByText(/ID 456/)).toHaveCount(0);
  await expect(firstCard.getByText("www.olympicbootworks.com")).toHaveCount(0);
  await expect(firstCard.getByText("View", { exact: true })).toHaveCount(0);
  await expect(firstCard.getByText("Growing", { exact: true })).toHaveCount(0);
});

test("dashboard reserves semantic color for material changes", async ({
  page,
}) => {
  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboardFixture),
    });
  });

  await page.goto("/");

  const neutralChange = page
    .getByRole("link", { name: "Open Olympic Bootworks Website analytics" })
    .getByTestId("property-change");
  const positiveChange = page
    .getByRole("link", { name: "Open Prism analytics" })
    .getByTestId("property-change");
  const criticalChange = page
    .getByRole("link", { name: "Open Canary Cove analytics" })
    .getByTestId("property-change");

  await expect(neutralChange).toHaveAttribute("data-trend-tone", "neutral");
  await expect(neutralChange).toHaveClass(/text-muted-foreground/);
  await expect(positiveChange).toHaveAttribute("data-trend-tone", "positive");
  await expect(positiveChange).toHaveClass(/text-positive/);
  await expect(criticalChange).toHaveAttribute("data-trend-tone", "critical");
  await expect(criticalChange).toHaveClass(/text-negative/);

  for (const currentValue of ["909", "263", "43"]) {
    await expect(page.getByText(currentValue, { exact: true })).toHaveClass(
      /text-foreground/,
    );
  }
});

test("priority signal renders only for a critical decline", async ({ page }) => {
  const materialButNotCritical = {
    ...dashboardFixture,
    properties: [
      {
        ...dashboardFixture.properties[0],
        propertyId: "moderate",
        displayName: "Moderate decline",
        newUsers: { current: 80, previous: 100, delta: -20, pct: -0.2 },
      },
    ],
  };

  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(materialButNotCritical),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Priority signal", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("property-change")).toHaveAttribute(
    "data-trend-tone",
    "negative",
  );
});

test("dashboard connection failure uses the negative attention color", async ({
  page,
}) => {
  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unavailable" }),
    });
  });

  await page.goto("/");
  const blockingError = page.getByTestId("dashboard-error");
  await expect(blockingError).toHaveClass(/text-negative/);
  await expect(blockingError).toContainText(
    "No analytics values are available yet.",
  );
});

test("dashboard refresh failure stays neutral when prior data remains", async ({
  page,
}) => {
  let failRequests = false;
  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: failRequests ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        failRequests ? { error: "Unavailable" } : dashboardFixture,
      ),
    });
  });

  await page.goto("/");
  await expect(page.getByText("909", { exact: true })).toBeVisible();
  failRequests = true;
  await page.getByRole("button", { name: "Refresh analytics data" }).click();

  const staleError = page.getByTestId("dashboard-error");
  await expect(staleError).toHaveAttribute("data-error-severity", "stale");
  await expect(staleError).toHaveClass(/text-muted-foreground/);
  await expect(staleError).not.toHaveClass(/text-negative/);
  await expect(staleError).toContainText("Existing values remain visible.");
  await expect(page.getByText("909", { exact: true })).toBeVisible();
});

test("dashboard keeps only reporting and status controls", async ({ page }) => {
  await page.route("**/api/dashboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboardFixture),
    });
  });

  await page.goto("/");
  await expect(page.getByLabel("Reporting window")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh analytics data" }),
  ).toBeVisible();
  await expect(page.getByLabel("Filter by status")).toBeVisible();
  await expect(page.getByLabel("Search properties")).toHaveCount(0);
  await expect(page.getByLabel("Sort properties")).toHaveCount(0);
  await expect(page.getByTestId("property-card")).toHaveCount(
    dashboardFixture.properties.length,
  );

  await page.getByLabel("Filter by status").click();
  const decliningOption = page.getByRole("option", { name: "Declining" });
  await page.waitForTimeout(250);
  const decliningOptionBox = await decliningOption.boundingBox();
  expect(decliningOptionBox?.height).toBeGreaterThanOrEqual(44);
  await decliningOption.click();
  await expect(page.getByTestId("property-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Canary Cove", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Flat" }).click();
  await expect(page.getByTestId("property-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No properties in this status" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all properties" }).click();
  await expect(page.getByTestId("property-card")).toHaveCount(
    dashboardFixture.properties.length,
  );
});

test.describe("desktop property grid", () => {
  test.use({ viewport: { width: 1360, height: 900 } });

  test("uses one card per property with no table renderer", async ({ page }) => {
    await page.route("**/api/dashboard?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(dashboardFixture),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("property-cards")).toBeVisible();
    await expect(page.getByTestId("property-card")).toHaveCount(
      dashboardFixture.properties.length,
    );
    await expect(
      page.getByRole("navigation", { name: "Property pages" }),
    ).toHaveCount(0);
    await expect(page.locator("table")).toHaveCount(0);

    const columnCount = await page
      .getByTestId("property-cards")
      .locator(":scope > div")
      .evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      );
    expect(columnCount).toBe(3);
  });
});
