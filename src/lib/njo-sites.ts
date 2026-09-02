import { JWT } from "google-auth-library";
import { unstable_cache } from "next/cache";

const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const REQUEST_TIMEOUT_MS = 25_000;
const HISTORICAL_FLOOR = "2024-01-01";
const DAILY_ROW_LIMIT = 5000;
const SUMMARY_ROW_LIMIT = 10;

export type NjoPeriodId = "last30" | "last90" | "ytd" | "all";
export type SiteId = "njo" | "pti";

type RunReportResponse = {
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
};

type GscQueryResponse = {
  rows?: {
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }[];
};

export type NjoSiteConfig = {
  id: SiteId;
  name: string;
  domain: string;
  url: string;
  gaPropertyId: string;
  gaMeasurementId: string;
  gscSiteUrl: string;
  hostNames: string[];
};

export const NJO_SITES: NjoSiteConfig[] = [
  {
    id: "njo",
    name: "Michael Njo, DDS",
    domain: "michaelnjodds.com",
    url: "https://michaelnjodds.com",
    gaPropertyId: "516211709",
    gaMeasurementId: "G-6HWEE040EH",
    gscSiteUrl: "sc-domain:michaelnjodds.com",
    hostNames: ["michaelnjodds.com", "www.michaelnjodds.com"],
  },
  {
    id: "pti",
    name: "Practice Transitions Institute",
    domain: "practicetransitionsinstitute.com",
    url: "https://practicetransitionsinstitute.com",
    gaPropertyId: "502361992",
    gaMeasurementId: "G-XCBKH87HG5",
    gscSiteUrl: "sc-domain:practicetransitionsinstitute.com",
    hostNames: [
      "practicetransitionsinstitute.com",
      "www.practicetransitionsinstitute.com",
    ],
  },
];

const PERIOD_LABELS: Record<
  NjoPeriodId,
  { label: string; shortLabel: string }
> = {
  last30: { label: "Last 30 days", shortLabel: "30D" },
  last90: { label: "Last 90 days", shortLabel: "90D" },
  ytd: { label: "Year to date", shortLabel: "YTD" },
  all: { label: "All available", shortLabel: "All" },
};

let gaAuthClient: JWT | null = null;
let gscAuthClient: JWT | null = null;

const formatUtcDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseIsoDate = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const addUtcDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const parseGaDate = (value: string): string => {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const chartLabel = (value: string): string =>
  new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);

const formatPercent = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value);

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

const gscStartDate = (from: string, to: string): string => {
  const floor = formatUtcDate(addUtcDays(parseIsoDate(to), -(16 * 30)));
  return from < floor ? floor : from;
};

const yesterdayUtc = (): Date => addUtcDays(new Date(), -1);

const buildRange = (
  periodId: NjoPeriodId,
): {
  id: NjoPeriodId;
  from: string;
  to: string;
  label: string;
  shortLabel: string;
  rangeLabel: string;
  detail: string;
} => {
  const toDate = yesterdayUtc();
  const to = formatUtcDate(toDate);
  const meta = PERIOD_LABELS[periodId];
  let fromDate = addUtcDays(toDate, -29);

  if (periodId === "last90") {
    fromDate = addUtcDays(toDate, -89);
  } else if (periodId === "ytd") {
    fromDate = new Date(Date.UTC(toDate.getUTCFullYear(), 0, 1));
  } else if (periodId === "all") {
    fromDate = parseIsoDate(HISTORICAL_FLOOR);
  }

  const from = formatUtcDate(fromDate);
  const rangeLabel =
    periodId === "all"
      ? `All available through ${chartLabel(to)}, ${toDate.getUTCFullYear()}`
      : `${chartLabel(from)}-${chartLabel(to)}, ${toDate.getUTCFullYear()}`;

  return {
    id: periodId,
    from,
    to,
    label: meta.label,
    shortLabel: meta.shortLabel,
    rangeLabel,
    detail:
      periodId === "all"
        ? `Live GA4/GSC rows through ${to}.`
        : `Live GA4/GSC rows for ${rangeLabel}.`,
  };
};

const getPrivateKey = (): { email: string; key: string } => {
  const email = process.env.GA_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GA_PRIVATE_KEY;
  if (!email || !privateKeyRaw) {
    throw new Error(
      "Missing GA_CLIENT_EMAIL or GA_PRIVATE_KEY environment variables.",
    );
  }
  return { email, key: privateKeyRaw.replace(/\\n/g, "\n") };
};

const getGaToken = async (): Promise<string> => {
  const { email, key } = getPrivateKey();
  gaAuthClient ??= new JWT({ email, key, scopes: [GA_SCOPE] });
  const tokenResponse = await gaAuthClient.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!token) {
    throw new Error("Unable to authorize the Google Analytics service account.");
  }
  return token;
};

const getGscToken = async (): Promise<string> => {
  const { email, key } = getPrivateKey();
  gscAuthClient ??= new JWT({ email, key, scopes: [GSC_SCOPE] });
  const tokenResponse = await gscAuthClient.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!token) {
    throw new Error("Unable to authorize the Search Console service account.");
  }
  return token;
};

const fetchJson = async <T>(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 800);
    } catch {
      detail = "";
    }
    throw new Error(
      `Google API error ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
};

const hostnameFilter = (hostNames: string[]) => ({
  orGroup: {
    expressions: hostNames.map((hostName) => ({
      filter: {
        fieldName: "hostName",
        stringFilter: { matchType: "EXACT", value: hostName },
      },
    })),
  },
});

const runGaReport = async (
  token: string,
  propertyId: string,
  hostNames: string[],
  range: { from: string; to: string },
  body: Record<string, unknown>,
): Promise<RunReportResponse> =>
  fetchJson<RunReportResponse>(
    `${DATA_BASE}/properties/${propertyId}:runReport`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: range.from, endDate: range.to }],
        dimensionFilter: hostnameFilter(hostNames),
        ...body,
      }),
    },
  );

const queryGsc = async (
  token: string,
  siteUrl: string,
  range: { from: string; to: string },
  dimensions: string[],
  rowLimit: number,
): Promise<GscQueryResponse> =>
  fetchJson<GscQueryResponse>(
    `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: gscStartDate(range.from, range.to),
        endDate: range.to,
        dimensions,
        rowLimit,
      }),
    },
  );

const metricValues = (
  row: NonNullable<RunReportResponse["rows"]>[number],
  keys: string[],
): Record<string, number> =>
  Object.fromEntries(
    keys.map((key, index) => [
      key,
      Number(row.metricValues?.[index]?.value ?? 0),
    ]),
  );

const buildDailyRows = ({
  from,
  to,
  gaRows = [],
  gscRows = [],
}: {
  from: string;
  to: string;
  gaRows?: NonNullable<RunReportResponse["rows"]>;
  gscRows?: NonNullable<GscQueryResponse["rows"]>;
}) => {
  const gaByDate = new Map<
    string,
    {
      activeUsers: number;
      newUsers: number;
      sessions: number;
      views: number;
      eventCount: number;
    }
  >();
  const gscByDate = new Map<
    string,
    { gscClicks: number; gscImpressions: number }
  >();

  for (const row of gaRows) {
    const date = parseGaDate(row.dimensionValues?.[0]?.value ?? "");
    if (!date) continue;
    gaByDate.set(
      date,
      metricValues(row, [
        "activeUsers",
        "newUsers",
        "sessions",
        "views",
        "eventCount",
      ]) as {
        activeUsers: number;
        newUsers: number;
        sessions: number;
        views: number;
        eventCount: number;
      },
    );
  }

  for (const row of gscRows) {
    const date = row.keys?.[0];
    if (!date) continue;
    gscByDate.set(date, {
      gscClicks: Number(row.clicks ?? 0),
      gscImpressions: Number(row.impressions ?? 0),
    });
  }

  const rows = [];
  const cursor = parseIsoDate(from);
  const end = parseIsoDate(to);
  while (cursor <= end) {
    const date = formatUtcDate(cursor);
    rows.push({
      date,
      label: chartLabel(date),
      activeUsers: 0,
      newUsers: 0,
      sessions: 0,
      views: 0,
      eventCount: 0,
      gscClicks: 0,
      gscImpressions: 0,
      ...(gaByDate.get(date) ?? {}),
      ...(gscByDate.get(date) ?? {}),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
};

const firstNonzeroDate = (
  rows: { date: string; [key: string]: string | number }[],
  keys: string[],
): string | null =>
  rows.find((row) => keys.some((key) => Number(row[key] ?? 0) > 0))?.date ??
  null;

const sumSearchRows = (rows: NonNullable<GscQueryResponse["rows"]> = []) => {
  const totals = rows.reduce(
    (summary, row) => {
      const clicks = Number(row.clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);
      const position = Number(row.position ?? 0);
      return {
        clicks: summary.clicks + clicks,
        impressions: summary.impressions + impressions,
        positionWeight: summary.positionWeight + position * impressions,
      };
    },
    { clicks: 0, impressions: 0, positionWeight: 0 } as {
      clicks: number;
      impressions: number;
      positionWeight: number;
    },
  );

  return {
    clicks: totals.clicks,
    impressions: totals.impressions,
    ctr: totals.impressions === 0 ? 0 : totals.clicks / totals.impressions,
    position:
      totals.impressions === 0 ? 0 : totals.positionWeight / totals.impressions,
  };
};

const fetchSiteSnapshot = async (
  site: NjoSiteConfig,
  range: ReturnType<typeof buildRange>,
  generatedAt: string,
) => {
  const gaToken = await getGaToken();
  const [gaDailyResult, gaPagesResult, gaChannelsResult, gscResult] =
    await Promise.allSettled([
      runGaReport(gaToken, site.gaPropertyId, site.hostNames, range, {
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "activeUsers" },
          { name: "newUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "eventCount" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: DAILY_ROW_LIMIT,
      }),
      runGaReport(gaToken, site.gaPropertyId, site.hostNames, range, {
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "newUsers" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: SUMMARY_ROW_LIMIT,
      }),
      runGaReport(gaToken, site.gaPropertyId, site.hostNames, range, {
        dimensions: [{ name: "firstUserDefaultChannelGroup" }],
        metrics: [
          { name: "newUsers" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
        ],
        orderBys: [{ metric: { metricName: "newUsers" }, desc: true }],
        limit: SUMMARY_ROW_LIMIT,
      }),
      (async () => {
        const gscToken = await getGscToken();
        const [daily, queries] = await Promise.all([
          queryGsc(gscToken, site.gscSiteUrl, range, ["date"], DAILY_ROW_LIMIT),
          queryGsc(
            gscToken,
            site.gscSiteUrl,
            range,
            ["query"],
            SUMMARY_ROW_LIMIT,
          ),
        ]);
        return { daily, queries };
      })(),
    ]);

  const gaError =
    gaDailyResult.status === "rejected"
      ? gaDailyResult.reason instanceof Error
        ? gaDailyResult.reason.message
        : String(gaDailyResult.reason)
      : null;
  const gscError =
    gscResult.status === "rejected"
      ? gscResult.reason instanceof Error
        ? gscResult.reason.message
        : String(gscResult.reason)
      : null;

  const gaDaily =
    gaDailyResult.status === "fulfilled" ? gaDailyResult.value.rows : [];
  const gaPages =
    gaPagesResult.status === "fulfilled" ? gaPagesResult.value.rows : [];
  const gaChannels =
    gaChannelsResult.status === "fulfilled" ? gaChannelsResult.value.rows : [];
  const gscDaily =
    gscResult.status === "fulfilled" ? (gscResult.value.daily.rows ?? []) : [];
  const gscQueries =
    gscResult.status === "fulfilled"
      ? (gscResult.value.queries.rows ?? [])
      : [];

  const gscAvailable = gscResult.status === "fulfilled";
  const gaAvailable = gaDailyResult.status === "fulfilled";

  const earliestGa = gaDaily
    ?.map((row) => parseGaDate(row.dimensionValues?.[0]?.value ?? ""))
    .filter(Boolean)
    .sort()[0];
  const earliestGsc = gscDaily
    .map((row) => row.keys?.[0])
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  const dailyFrom =
    range.id === "all" ? (earliestGa ?? earliestGsc ?? range.from) : range.from;
  const trafficTrend = buildDailyRows({
    from: dailyFrom,
    to: range.to,
    gaRows: gaDaily,
    gscRows: gscDaily,
  });

  const gaTotals = trafficTrend.reduce(
    (summary, row) => ({
      activeUsers: summary.activeUsers + row.activeUsers,
      newUsers: summary.newUsers + row.newUsers,
      sessions: summary.sessions + row.sessions,
      views: summary.views + row.views,
      eventCount: summary.eventCount + row.eventCount,
    }),
    { activeUsers: 0, newUsers: 0, sessions: 0, views: 0, eventCount: 0 },
  );
  const searchSummary = gscAvailable
    ? sumSearchRows(gscDaily)
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  const channels = (gaChannels ?? []).map((row) => {
    const metrics = metricValues(row, [
      "newUsers",
      "engagedSessions",
      "engagementRate",
    ]);
    return {
      channel: row.dimensionValues?.[0]?.value ?? "(not set)",
      newUsers: metrics.newUsers ?? 0,
      engagedSessions: metrics.engagedSessions ?? 0,
      engagementRate: metrics.engagementRate ?? 0,
    };
  });
  const topChannel = [...channels].sort((a, b) => b.newUsers - a.newUsers)[0];
  const gaStarts = firstNonzeroDate(trafficTrend, [
    "activeUsers",
    "newUsers",
    "sessions",
    "views",
    "eventCount",
  ]);
  const gscStarts = firstNonzeroDate(trafficTrend, [
    "gscClicks",
    "gscImpressions",
  ]);

  const metrics = [
    {
      label: "GA4 new users",
      value: gaAvailable ? formatNumber(gaTotals.newUsers) : "Pending",
      detail: gaAvailable
        ? `GA4 property ${site.gaPropertyId}; production hostnames only; ${range.rangeLabel}.`
        : (gaError ?? "GA4 report unavailable."),
    },
    {
      label: "GA4 views",
      value: gaAvailable ? formatNumber(gaTotals.views) : "Pending",
      detail: gaAvailable
        ? `${formatNumber(gaTotals.views)} page views and ${formatNumber(gaTotals.sessions)} sessions.`
        : (gaError ?? "GA4 report unavailable."),
    },
    {
      label: "GSC clicks",
      value: gscAvailable ? formatNumber(searchSummary.clicks) : "Pending",
      detail: gscAvailable
        ? `${formatNumber(searchSummary.clicks)} clicks from ${formatNumber(searchSummary.impressions)} impressions.`
        : (gscError ?? "Search Console unavailable."),
    },
    {
      label: "GSC impressions",
      value: gscAvailable ? formatNumber(searchSummary.impressions) : "Pending",
      detail: gscAvailable
        ? `${formatPercent(searchSummary.ctr)} CTR; average position ${searchSummary.position.toFixed(1)}.`
        : (gscError ?? "Search Console unavailable."),
    },
  ];

  const status = gaAvailable ? "connected" : "needs_reauth";
  const summary = gaAvailable
    ? `${site.domain} ${range.label.toLowerCase()}: ${formatNumber(gaTotals.newUsers)} GA4 new users, ${formatNumber(gaTotals.views)} views${gscAvailable ? `, ${formatNumber(searchSummary.impressions)} GSC impressions` : " (Search Console pending)"}. ${topChannel ? `${topChannel.channel} leads the channel mix` : "Channel mix is pending"}.`
    : `${site.domain} could not load live GA4 for ${range.rangeLabel}.`;

  return {
    siteId: site.id,
    periodId: range.id,
    status,
    checkedAt: generatedAt,
    rangeLabel: range.rangeLabel,
    summary,
    metrics,
    trafficTrend,
    searchSummary,
    acquisition: {
      status: channels.length > 0 ? "available" : "needs_reauth",
      dimension: "firstUserDefaultChannelGroup" as const,
      metric: "newUsers" as const,
      note: `GA4 first-user acquisition by default channel group for ${range.rangeLabel}, limited to ${site.hostNames.join(" and ")}.`,
      channels,
    },
    topQueries: gscAvailable
      ? gscQueries.map((row) => ({
          query: row.keys?.[0] ?? "(not set)",
          clicks: Number(row.clicks ?? 0),
          impressions: Number(row.impressions ?? 0),
          ctr: Number(row.ctr ?? 0),
          position: Number(row.position ?? 0),
        }))
      : [],
    topPages: (gaPages ?? []).map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? "/",
      title: row.dimensionValues?.[1]?.value ?? "",
      ...metricValues(row, ["views", "activeUsers", "newUsers"]),
    })),
    diagnostics: [
      {
        label: "GA4 property",
        value: site.gaPropertyId,
        detail: gaAvailable
          ? "Live GA4 Data API rows for production hostnames."
          : (gaError ?? "GA4 unavailable."),
      },
      {
        label: "Measurement ID",
        value: site.gaMeasurementId,
        detail: "Public website measurement ID.",
      },
      {
        label: "GSC property",
        value: site.gscSiteUrl,
        detail: gscAvailable
          ? "Live Search Console searchAnalytics rows."
          : (gscError ?? "Search Console unavailable for this service account."),
      },
      {
        label: "Checked",
        value: formatDateTime(generatedAt),
        detail: "Live Google refresh, cached for one minute.",
      },
      {
        label: "GA4 starts",
        value: gaStarts
          ? formatDateTime(`${gaStarts}T00:00:00`)
          : gaAvailable
            ? "No rows"
            : "Pending",
        detail: "Earliest nonzero GA4 row in this window.",
      },
      {
        label: "GSC starts",
        value: gscStarts
          ? formatDateTime(`${gscStarts}T00:00:00`)
          : gscAvailable
            ? "No rows"
            : "Pending",
        detail: "Earliest nonzero Search Console row in this window.",
      },
    ],
    sources: {
      ga4: gaAvailable ? "connected" : "unavailable",
      gsc: gscAvailable ? "connected" : "unavailable",
      gaError,
      gscError,
    },
  };
};

export const isNjoPeriodId = (value: string): value is NjoPeriodId =>
  value === "last30" ||
  value === "last90" ||
  value === "ytd" ||
  value === "all";

export const getNjoSitesReport = async (periodId: NjoPeriodId) => {
  const generatedAt = new Date().toISOString();
  const range = buildRange(periodId);
  const snapshots = await Promise.all(
    NJO_SITES.map((site) => fetchSiteSnapshot(site, range, generatedAt)),
  );

  return {
    generatedAt,
    period: {
      id: range.id,
      label: range.label,
      shortLabel: range.shortLabel,
      rangeLabel: range.rangeLabel,
      detail: range.detail,
      status: "available" as const,
    },
    periods: (["last30", "last90", "ytd", "all"] as NjoPeriodId[]).map(
      (id) => {
        const item = buildRange(id);
        return {
          id: item.id,
          label: item.label,
          shortLabel: item.shortLabel,
          rangeLabel: item.rangeLabel,
          detail: item.detail,
          status: "available" as const,
        };
      },
    ),
    snapshots,
    sites: NJO_SITES.map((site) => ({
      id: site.id,
      name: site.name,
      domain: site.domain,
      url: site.url,
      gaPropertyId: site.gaPropertyId,
      gaMeasurementId: site.gaMeasurementId,
      gscSiteUrl: site.gscSiteUrl,
    })),
  };
};

const readCachedNjoSitesReport = unstable_cache(
  async (periodId: NjoPeriodId) => getNjoSitesReport(periodId),
  ["njo-sites-report-v1"],
  { revalidate: 60 },
);

export const getCachedNjoSitesReport = (periodId: NjoPeriodId) =>
  readCachedNjoSitesReport(periodId);
