import type { TrackedProject } from "./tracked-projects";
import type { DashboardProperty, DashboardWindow, PropertyDetailResponse } from "./types";

const API = "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";
const DAY = 86_400_000;
const DAYS: Record<DashboardWindow, number> = { d1: 1, d7: 7, d28: 28, d90: 90, d180: 180, d365: 365 };
const FILTER = "environment eq 'production'";
type Range = { since: string; until: string };
type Row = { visitors: number; timestamp?: string; environment?: string };
const date = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

export function getVercelDateRanges(windowKey: DashboardWindow, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = DAYS[windowKey];
  return {
    current: { since: date(today - days * DAY), until: date(today - DAY) },
    previous: { since: date(today - 2 * days * DAY), until: date(today - (days + 1) * DAY) },
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRows(value: unknown, range: Range, by: "day" | "environment"): Row[] {
  if (!object(value) || !object(value.query) || !Array.isArray(value.data)) {
    throw new Error("Vercel Analytics returned an invalid response.");
  }
  const query = value.query;
  // The API can clamp queries to a plan's retention period. Never present a
  // shortened reporting period as the requested window (especially comparisons).
  const timestamp = (actual: unknown) => typeof actual === "string" ? Date.parse(actual) : NaN;
  const expectedStart = Date.parse(range.since);
  const expectedEnd = Date.parse(range.until) + DAY;
  if (timestamp(query.since) !== expectedStart || (timestamp(query.until) !== expectedEnd && timestamp(query.until) !== expectedEnd - 1)) {
    throw new Error("This date range exceeds the available Vercel Analytics history. Select a shorter period.");
  }
  if (query.groupBy !== undefined && (!Array.isArray(query.groupBy) || query.groupBy.length !== 1 || query.groupBy[0] !== by)) {
    throw new Error("Vercel Analytics returned an unexpected grouping.");
  }
  const seen = new Set<string>();
  return value.data.map((row: unknown) => {
    if (!object(row) || typeof row.visitors !== "number" || !Number.isSafeInteger(row.visitors) || row.visitors < 0) {
      throw new Error("Vercel Analytics returned an invalid visitor count.");
    }
    if (by === "environment") {
      if (row.environment !== "production" || seen.has("production")) {
        throw new Error("Vercel Analytics returned an unexpected environment.");
      }
      seen.add("production");
      return { visitors: row.visitors, environment: "production" };
    }
    if (typeof row.timestamp !== "string" || !Number.isFinite(Date.parse(row.timestamp))) {
      throw new Error("Vercel Analytics returned an invalid date.");
    }
    const day = date(Date.parse(row.timestamp));
    if (day < range.since || day > range.until || seen.has(day)) {
      throw new Error("Vercel Analytics returned duplicate or out-of-range dates.");
    }
    seen.add(day);
    return { visitors: row.visitors, timestamp: day };
  });
}

async function query(project: TrackedProject, range: Range, by: "day" | "environment"): Promise<Row[]> {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  if (!token) throw new Error("Connect Vercel Analytics: configure VERCEL_ANALYTICS_TOKEN on the dashboard.");
  const url = new URL(API);
  url.searchParams.set("projectId", project.vercelProjectId);
  url.searchParams.set("since", `${range.since}T00:00:00.000Z`);
  url.searchParams.set("until", `${range.until}T23:59:59.999Z`);
  url.searchParams.set("by", by);
  url.searchParams.set("filter", FILTER);
  url.searchParams.set("limit", "100");
  if (process.env.VERCEL_ANALYTICS_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_ANALYTICS_TEAM_ID);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(5_000),
      });
    } catch {
      if (attempt === 0) continue;
      throw new Error("Vercel Analytics could not be reached. Try again shortly.");
    }
    if (response.ok) {
      let payload: unknown;
      try { payload = await response.json(); } catch {
        throw new Error("Vercel Analytics returned an invalid response.");
      }
      return parseRows(payload, range, by);
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    // Never echo provider bodies: these may contain account identifiers or details.
    if (response.status === 401 || response.status === 403) throw new Error("Vercel Analytics access unavailable. Check the dashboard token and team permissions.");
    if (response.status === 404) throw new Error("Vercel Analytics unavailable. Check the project and enable Web Analytics.");
    if (response.status === 400 || response.status === 422) {
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      const providerError = object(body) && object(body.error) ? body.error : body;
      const message = object(providerError) && typeof providerError.message === "string" ? providerError.message : "";
      const code = object(providerError) && typeof providerError.code === "string" ? providerError.code : "";
      if (/not.?enabled|disabled/i.test(`${code} ${message}`)) {
        throw new Error("Web Analytics is not enabled for this project. Enable it in Vercel to begin collecting visitors.");
      }
      if (/limit/i.test(`${code} ${message}`)) {
        throw new Error("Vercel Analytics rejected the query result limit. The dashboard adapter needs an update.");
      }
      throw new Error("Vercel Analytics cannot report this period. Check that Web Analytics is enabled and select a period within your plan's history.");
    }
    throw new Error(`Vercel Analytics request failed (${response.status}). Try again shortly.`);
  }
  throw new Error("Vercel Analytics is temporarily unavailable.");
}

async function queryDays(project: TrackedProject, range: Range): Promise<Row[]> {
  const rows: Row[] = [];
  const end = Date.parse(range.until);
  // The API caps result limits at 100. Keep each daily query below that cap,
  // without splitting whole-period totals (which would duplicate visitors).
  for (let start = Date.parse(range.since); start <= end; start += 90 * DAY) {
    rows.push(...await query(project, {
      since: date(start), until: date(Math.min(end, start + 89 * DAY)),
    }, "day"));
  }
  return rows;
}

function metadata(project: TrackedProject) {
  return { propertyId: `vercel-${project.slug}`, displayName: project.name, defaultUri: project.url, emoji: "", source: "vercel" as const, metric: "visitors" as const, metricLabel: "Visitors" };
}

async function read(project: TrackedProject, windowKey: DashboardWindow, includeSeries: boolean): Promise<PropertyDetailResponse> {
  const base = { updatedAt: new Date().toISOString(), window: windowKey, property: metadata(project) };
  try {
    const ranges = getVercelDateRanges(windowKey);
    // Whole-period visitors come from one production group, never a sum of daily
    // distinct visitors. Count endpoint is lifetime-only and cannot serve windows.
    const [current, previous, currentDays, previousDays] = await Promise.all([
      query(project, ranges.current, "environment"), query(project, ranges.previous, "environment"),
      includeSeries ? queryDays(project, ranges.current) : Promise.resolve([]),
      includeSeries ? queryDays(project, ranges.previous) : Promise.resolve([]),
    ]);
    const currentTotal = current[0]?.visitors ?? 0;
    const previousTotal = previous[0]?.visitors ?? 0;
    const currentMap = new Map(currentDays.map((row) => [row.timestamp, row.visitors]));
    const previousMap = new Map(previousDays.map((row) => [row.timestamp, row.visitors]));
    const series = includeSeries ? Array.from({ length: DAYS[windowKey] }, (_, index) => {
      const day = date(Date.parse(ranges.current.since) + index * DAY);
      const priorDay = date(Date.parse(ranges.previous.since) + index * DAY);
      return { date: day, current: currentMap.get(day) ?? 0, previous: previousMap.get(priorDay) ?? 0 };
    }) : [];
    return { ...base, summary: { current: currentTotal, previous: previousTotal, delta: currentTotal - previousTotal, pct: previousTotal === 0 ? null : (currentTotal - previousTotal) / previousTotal }, series, error: null };
  } catch (error) {
    return { ...base, summary: null, series: [], error: error instanceof Error ? error.message : "Vercel Analytics is unavailable." };
  }
}

export const getVercelProjectDetail = (project: TrackedProject, windowKey: DashboardWindow) => read(project, windowKey, true);
export async function getVercelDashboardProperty(project: TrackedProject, windowKey: DashboardWindow): Promise<DashboardProperty> {
  const detail = await read(project, windowKey, false);
  return { ...detail.property, newUsers: detail.summary, error: detail.error };
}
