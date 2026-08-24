import { expect, test } from "@playwright/test";
import {
  dedupeStreamResultsByDomain,
  getCurrentDateRange,
  getDateRanges,
  getPropertyDetail,
  isRetryableGoogleStatus,
} from "../src/lib/ga";

test("date windows end on the last completed day in the property timezone", () => {
  const now = new Date("2026-08-24T02:21:00Z");

  expect(getDateRanges("d1", "America/Los_Angeles", now)).toEqual({
    current: { startDate: "2026-08-22", endDate: "2026-08-22" },
    previous: { startDate: "2026-08-21", endDate: "2026-08-21" },
  });
  expect(getDateRanges("d7", "America/Los_Angeles", now)).toEqual({
    current: { startDate: "2026-08-16", endDate: "2026-08-22" },
    previous: { startDate: "2026-08-09", endDate: "2026-08-15" },
  });
  expect(getCurrentDateRange(30, "America/Los_Angeles", now)).toEqual({
    startDate: "2026-07-24",
    endDate: "2026-08-22",
  });
});

test("duplicate domains always select the newest property before reports run", () => {
  const legacy = {
    summary: { propertyId: "493377728", displayName: "Olympic legacy" },
    webStream: {
      defaultUri: "https://www.olympicbootworks.com/",
      measurementId: null,
    },
    timeZone: "America/Los_Angeles",
    error: null,
  };
  const current = {
    summary: { propertyId: "508275630", displayName: "Olympic current" },
    webStream: {
      defaultUri: "https://www.olympicbootworks.com",
      measurementId: null,
    },
    timeZone: "America/Los_Angeles",
    error: null,
  };

  expect(dedupeStreamResultsByDomain([legacy, current])).toEqual([current]);
  expect(dedupeStreamResultsByDomain([current, legacy])).toEqual([current]);
});

test("only transient Google API failures are retried", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    expect(isRetryableGoogleStatus(status)).toBe(true);
  }
  for (const status of [400, 401, 403, 404]) {
    expect(isRetryableGoogleStatus(status)).toBe(false);
  }
});

test("hidden properties cannot be loaded directly", async () => {
  const result = await getPropertyDetail("518332323", "d7");

  expect(result.property.propertyId).toBe("518332323");
  expect(result.summary).toBeNull();
  expect(result.series).toEqual([]);
  expect(result.error).toBe("Property is excluded from the dashboard.");
});
