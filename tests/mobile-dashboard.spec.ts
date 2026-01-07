import { expect, test } from "@playwright/test";

const dashboardFixture = {
  updatedAt: "2026-01-07T00:00:00Z",
  window: "d7",
  properties: [
    {
      propertyId: "456",
      displayName: "Olympic Bootworks Website",
      defaultUri: "https://www.olympicbootworks.com",
      newUsers: { current: 909, previous: 820, delta: 89, pct: 0.1085 },
      error: null,
    },
    {
      propertyId: "123",
      displayName: "Prism",
      defaultUri: "https://www.design-prism.com",
      newUsers: { current: 263, previous: 225, delta: 38, pct: 0.1688 },
      error: null,
    },
  ],
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

  await page.goto("/");
  await expect(page.getByText("New Users Pulse")).toBeVisible();
  await expect(page.getByTestId("property-cards")).toBeVisible();
  await expect(page.getByTestId("property-card")).toHaveCount(2);
  await expect(page.getByText("Olympic Bootworks Website")).toBeVisible();
  await expect(page.getByText("New Users")).toBeVisible();

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasOverflow).toBeFalsy();
});
