import { expect, test } from "@playwright/test";

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
  ],
};

const totalFixture = {
  updatedAt: "2026-01-07T00:00:00Z",
  window: "d30",
  total: 1172,
  propertyCount: 2,
  errorCount: 0,
};

test.use({ viewport: { width: 390, height: 844 } });

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
  await page.route("**/api/total?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(totalFixture),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Website Traffic")).toBeVisible();
  await expect(page.getByTestId("total-new-users")).toBeVisible();
  await expect(page.getByTestId("property-cards")).toBeVisible();
  await expect(page.getByTestId("property-card")).toHaveCount(2);
  await expect(page.getByText("Olympic Bootworks Website")).toBeVisible();
  await expect(
    page.getByTestId("property-card").first().getByText("New Users (7d)"),
  ).toBeVisible();

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBeFalsy();
});
