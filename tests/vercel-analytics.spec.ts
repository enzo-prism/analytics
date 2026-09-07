import { expect, test } from "@playwright/test";
import { getVercelDashboardProperty, getVercelDateRanges, getVercelProjectDetail } from "../src/lib/vercel-analytics";

const project = { slug: "marble", name: "Marble", url: "https://example.test", vercelProjectId: "prj_test" };
const originalFetch = global.fetch;
const originalToken = process.env.VERCEL_ANALYTICS_TOKEN;
const originalTeam = process.env.VERCEL_ANALYTICS_TEAM_ID;
test.beforeEach(() => { process.env.VERCEL_ANALYTICS_TOKEN = "test-token"; process.env.VERCEL_ANALYTICS_TEAM_ID = "team_test"; });
test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.VERCEL_ANALYTICS_TOKEN; else process.env.VERCEL_ANALYTICS_TOKEN = originalToken;
  if (originalTeam === undefined) delete process.env.VERCEL_ANALYTICS_TEAM_ID; else process.env.VERCEL_ANALYTICS_TEAM_ID = originalTeam;
});

function fixture(url: URL) {
  const since = url.searchParams.get("since")!;
  const until = new Date(Date.parse(url.searchParams.get("until")!) + 1).toISOString();
  const by = url.searchParams.get("by");
  return { query: { since, until }, data: by === "environment" ? [{ environment: "production", visitors: 5 }] : [{ timestamp: since, visitors: 4 }, { timestamp: new Date(Date.parse(since) + 86400000).toISOString(), visitors: 4 }] };
}

test("UTC periods exclude today across a year boundary", () => {
  expect(getVercelDateRanges("d7", new Date("2026-01-03T21:00:00Z"))).toEqual({ current: { since: "2025-12-27", until: "2026-01-02" }, previous: { since: "2025-12-20", until: "2025-12-26" } });
});

test("whole-window totals do not sum daily distinct visitors; requests cover complete production days", async () => {
  const requests: URL[] = [];
  global.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    expect(url.searchParams.get("projectId")).toBe("prj_test");
    expect(url.searchParams.get("filter")).toBe("environment eq 'production'");
    expect(url.searchParams.get("teamId")).toBe("team_test");
    expect(url.searchParams.get("until")).toMatch(/T23:59:59.999Z$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    return Response.json(fixture(url));
  };
  const result = await getVercelProjectDetail(project, "d7");
  expect(result.error).toBeNull(); expect(result.summary?.current).toBe(5);
  expect(result.series.reduce((sum, point) => sum + point.current, 0)).toBe(8);
  expect(result.series).toHaveLength(7); expect(requests).toHaveLength(4);
  expect(result.property).toMatchObject({ propertyId: "vercel-marble", source: "vercel", metric: "visitors" });
});

test("missing credentials and denied access stay errors instead of zero traffic", async () => {
  delete process.env.VERCEL_ANALYTICS_TOKEN;
  global.fetch = async () => { throw new Error("must not fetch"); };
  const missing = await getVercelDashboardProperty(project, "d7");
  expect(missing.newUsers).toBeNull(); expect(missing.error).toContain("VERCEL_ANALYTICS_TOKEN");
  process.env.VERCEL_ANALYTICS_TOKEN = "test-token";
  let calls = 0; global.fetch = async () => { calls++; return new Response("private backend detail", { status: 403 }); };
  const denied = await getVercelDashboardProperty(project, "d7");
  expect(denied.newUsers).toBeNull(); expect(denied.error).toContain("permissions"); expect(denied.error).not.toContain("private"); expect(calls).toBe(2);
});

test("retention-clamped periods and partially covered final days are rejected", async () => {
  for (const partial of ["start", "end"]) {
    global.fetch = async (input) => {
      const data = fixture(new URL(String(input)));
      if (partial === "start") data.query.since = new Date(Date.parse(data.query.since) + 86400000).toISOString();
      else data.query.until = new Date(Date.parse(data.query.until) - 23 * 3600000).toISOString();
      return Response.json(data);
    };
    const result = await getVercelDashboardProperty(project, "d7");
    expect(result.newUsers).toBeNull(); expect(result.error).toContain("history");
  }
});

test("malformed counts and wrong environments are rejected", async () => {
  for (const row of [{ environment: "production", visitors: -1 }, { environment: "preview", visitors: 9 }, { environment: "production", visitors: "0" }]) {
    global.fetch = async (input) => Response.json({ ...fixture(new URL(String(input))), data: [row] });
    const result = await getVercelDashboardProperty(project, "d7");
    expect(result.newUsers).toBeNull(); expect(result.error).toBeTruthy();
  }
});

test("transient failures retry once then recover", async () => {
  const attempts = new Map<string, number>();
  global.fetch = async (input) => {
    const key = String(input); const count = (attempts.get(key) ?? 0) + 1; attempts.set(key, count);
    return count === 1 ? new Response("busy", { status: 503 }) : Response.json(fixture(new URL(key)));
  };
  const result = await getVercelDashboardProperty(project, "d7");
  expect(result.error).toBeNull(); expect([...attempts.values()]).toEqual([2, 2]);
});

test("180-day detail splits daily rows below the provider cap but keeps totals whole", async () => {
  const requests: URL[] = [];
  global.fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url);
    expect(url.searchParams.get("limit")).toBe("100");
    const data = fixture(url);
    if (url.searchParams.get("by") === "day") {
      const start = Date.parse(data.query.since), end = Date.parse(data.query.until);
      expect((end - start) / 86400000).toBeLessThanOrEqual(90);
      data.data = Array.from({ length: (end - start) / 86400000 }, (_, index) => ({ timestamp: new Date(start + index * 86400000).toISOString(), visitors: 1 }));
    }
    return Response.json(data);
  };
  const result = await getVercelProjectDetail(project, "d180");
  expect(result.error).toBeNull(); expect(result.series).toHaveLength(180);
  expect(result.series.every((point) => point.current === 1 && point.previous === 1)).toBe(true);
  expect(result.summary?.current).toBe(5);
  expect(requests.filter((url) => url.searchParams.get("by") === "day")).toHaveLength(4);
  expect(requests.filter((url) => url.searchParams.get("by") === "environment")).toHaveLength(2);
});

test("disabled analytics and invalid query limits use specific sanitized messages", async () => {
  for (const [message, expected] of [["Analytics not enabled for private-account", "not enabled"], ["limit should be <=100 for private-account", "result limit"]]) {
    global.fetch = async () => Response.json({ error: { code: "bad_request", message } }, { status: 400 });
    const result = await getVercelDashboardProperty(project, "d7");
    expect(result.newUsers).toBeNull(); expect(result.error).toContain(expected);
    expect(result.error).not.toContain("private-account");
  }
});
