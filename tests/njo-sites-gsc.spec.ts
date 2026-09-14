import { expect, test } from "@playwright/test";
import {
  gscFirstImpressionDate,
  pickBestGscProbe,
  shouldPreferGaOrganic,
} from "../src/lib/njo-gsc-select";

test("picks the Search Console property with the earliest history", () => {
  const picked = pickBestGscProbe(
    [
      {
        siteUrl: "https://michaelnjodds.com/",
        impressions: 164,
        startDate: "2026-09-02",
      },
      {
        siteUrl: "sc-domain:michaelnjodds.com",
        impressions: 400,
        startDate: "2025-08-01",
      },
    ],
    "michaelnjodds.com",
  );

  expect(picked?.siteUrl).toBe("sc-domain:michaelnjodds.com");
});

test("keeps a URL-prefix property when it is the only one with traffic", () => {
  const picked = pickBestGscProbe(
    [
      {
        siteUrl: "sc-domain:michaelnjodds.com",
        impressions: 0,
        startDate: null,
      },
      {
        siteUrl: "https://michaelnjodds.com/",
        impressions: 164,
        startDate: "2026-09-02",
      },
    ],
    "michaelnjodds.com",
  );

  expect(picked?.siteUrl).toBe("https://michaelnjodds.com/");
});

test("prefers GA4 organic search when it starts earlier than native GSC", () => {
  expect(shouldPreferGaOrganic("2026-09-02", "2026-01-15")).toBe(true);
  expect(shouldPreferGaOrganic("2026-09-02", "2026-09-02")).toBe(false);
  expect(shouldPreferGaOrganic(null, "2026-01-15")).toBe(true);
  expect(shouldPreferGaOrganic("2026-09-02", null)).toBe(false);
});

test("reads the first Search Console day with clicks or impressions", () => {
  expect(
    gscFirstImpressionDate([
      { keys: ["2026-08-15"], clicks: 0, impressions: 0 },
      { keys: ["2026-09-02"], clicks: 5, impressions: 15 },
      { keys: ["2026-09-03"], clicks: 0, impressions: 23 },
    ]),
  ).toBe("2026-09-02");
});
