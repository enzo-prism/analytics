import { JWT } from "google-auth-library";
import { unstable_cache } from "next/cache";

const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const SITE_VERIFY_BASE = "https://www.googleapis.com/siteVerification/v1";
const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GSC_READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const SITE_VERIFY_SCOPE = "https://www.googleapis.com/auth/siteverification";
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

type GscSiteEntry = {
  siteUrl?: string;
  permissionLevel?: string;
};

type GscBundle = {
  daily: GscQueryResponse;
  queries: GscQueryResponse;
  gscSiteUrl: string;
  via: "searchconsole" | "ga4";
};

type GaMetadata = {
  dimensions?: { apiName?: string; uiName?: string }[];
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

const jwtClients = new Map<string, JWT>();

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

const publicGoogleError = (
  error: string | null,
  kind: "ga4" | "gsc",
): string | null => {
  if (!error) return null;
  if (
    kind === "gsc" &&
    /sufficient permission|403|not a Search Console user/.test(error)
  ) {
    return "Service account is not a Search Console user on this property yet.";
  }
  if (/429/.test(error)) {
    return "Google is rate-limiting this report. Try again shortly.";
  }
  return kind === "gsc"
    ? "Search Console is temporarily unavailable."
    : "GA4 is temporarily unavailable.";
};

const getTokenForScopes = async (scopes: string[]): Promise<string> => {
  const cacheKey = scopes.join(" ");
  const { email, key } = getPrivateKey();
  let client = jwtClients.get(cacheKey);
  if (!client) {
    client = new JWT({ email, key, scopes });
    jwtClients.set(cacheKey, client);
  }
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!token) {
    throw new Error("Unable to authorize the Google service account.");
  }
  return token;
};

const getGaToken = async (): Promise<string> => getTokenForScopes([GA_SCOPE]);

const getGscToken = async (): Promise<string> => {
  const scopeSets = [
    [GSC_WRITE_SCOPE, SITE_VERIFY_SCOPE],
    [GSC_WRITE_SCOPE],
    [GSC_READ_SCOPE],
  ];
  let lastError: unknown = null;
  for (const scopes of scopeSets) {
    try {
      return await getTokenForScopes(scopes);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to authorize the Search Console service account.");
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

  const detail = await response.text();
  if (!response.ok) {
    throw new Error(
      `Google API error ${response.status} ${response.statusText}.${detail ? ` ${detail.slice(0, 800)}` : ""}`,
    );
  }
  if (!detail.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(detail) as T;
  } catch {
    throw new Error(
      `Google API returned non-JSON (${response.status} ${response.statusText}).`,
    );
  }
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
  hostNames: string[] | null,
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
        ...(hostNames ? { dimensionFilter: hostnameFilter(hostNames) } : {}),
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

const gscCandidateUrls = (site: NjoSiteConfig): string[] => {
  const domain = site.domain.toLowerCase();
  return [
    site.gscSiteUrl,
    `sc-domain:${domain}`,
    `https://www.${domain}/`,
    `https://${domain}/`,
    `http://www.${domain}/`,
    `http://${domain}/`,
  ].filter((url, index, all) => all.indexOf(url) === index);
};

const rankGscUrl = (siteUrl: string, domain: string): number => {
  const lower = siteUrl.toLowerCase();
  if (lower === `sc-domain:${domain}`) return 0;
  if (lower === `https://www.${domain}/`) return 1;
  if (lower === `https://${domain}/`) return 2;
  if (lower.includes(domain)) return 3;
  return 99;
};

const listGscSites = async (token: string): Promise<GscSiteEntry[]> => {
  const data = await fetchJson<{ siteEntry?: GscSiteEntry[] }>(
    `${GSC_BASE}/sites`,
    token,
  );
  return data.siteEntry ?? [];
};

const listedMatchForSite = (
  listedSites: GscSiteEntry[] | null,
  site: NjoSiteConfig,
): string | null => {
  if (!listedSites) return null;
  const domain = site.domain.toLowerCase();
  const matching = listedSites
    .map((entry) => entry.siteUrl)
    .filter((url): url is string => Boolean(url))
    .filter((url) => url.toLowerCase().includes(domain))
    .sort((a, b) => rankGscUrl(a, domain) - rankGscUrl(b, domain));
  return matching[0] ?? null;
};

const probeGscSiteUrl = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
): Promise<string | null> => {
  const probeRange = { from: range.to, to: range.to };
  for (const siteUrl of gscCandidateUrls(site)) {
    try {
      await queryGsc(token, siteUrl, probeRange, ["date"], 1);
      return siteUrl;
    } catch {
      continue;
    }
  }
  return null;
};

const canonicalPrefixUrl = (site: NjoSiteConfig): string =>
  `https://${site.domain.toLowerCase()}/`;

export const googleSiteVerificationBody = (filename: string): string =>
  `google-site-verification: ${filename}`;

const liveVerificationFileReady = async (
  site: NjoSiteConfig,
  filename: string,
): Promise<boolean> => {
  if (!/^google[a-z0-9]+\.html$/i.test(filename)) {
    return false;
  }
  const url = `${site.url.replace(/\/$/, "")}/${filename}`;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return false;
    }
    const body = (await response.text()).replace(/\s+$/g, "");
    return body === googleSiteVerificationBody(filename);
  } catch {
    return false;
  }
};

const getSiteVerificationToken = async (
  token: string,
  identifier: string,
  method: "FILE" | "META" | "ANALYTICS",
): Promise<string> => {
  const data = await fetchJson<{ token?: string }>(
    `${SITE_VERIFY_BASE}/token`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: { type: "SITE", identifier },
        verificationMethod: method,
      }),
    },
  );
  if (!data.token) {
    throw new Error(`Site Verification did not return a ${method} token.`);
  }
  return data.token;
};

const insertVerifiedWebResource = async (
  token: string,
  identifier: string,
  method: "FILE" | "META" | "ANALYTICS",
): Promise<void> => {
  await fetchJson(`${SITE_VERIFY_BASE}/webResource?verificationMethod=${method}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: { type: "SITE", identifier },
    }),
  });
};

const addSearchConsoleSite = async (
  token: string,
  siteUrl: string,
): Promise<void> => {
  await fetchJson(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}`, token, {
    method: "PUT",
  });
};

const claimGscPrefixProperty = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
): Promise<string | null> => {
  const identifier = canonicalPrefixUrl(site);
  const probeRange = { from: range.to, to: range.to };

  const finish = async (): Promise<string> => {
    try {
      await addSearchConsoleSite(token, identifier);
    } catch {
      // Already present on this service account, or write scope is missing.
    }
    await queryGsc(token, identifier, probeRange, ["date"], 1);
    return identifier;
  };

  try {
    await insertVerifiedWebResource(token, identifier, "ANALYTICS");
    return await finish();
  } catch {
    // Viewer on GA4 is usually not enough for ANALYTICS verification.
  }

  try {
    const filename = await getSiteVerificationToken(token, identifier, "FILE");
    if (await liveVerificationFileReady(site, filename)) {
      await insertVerifiedWebResource(token, identifier, "FILE");
      return await finish();
    }
  } catch {
    // Site Verification API may be disabled, or the HTML file is not live yet.
  }

  return null;
};

const resolveGscSiteUrl = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
  listedSites: GscSiteEntry[] | null,
): Promise<string> => {
  const listed = listedMatchForSite(listedSites, site);
  if (listed) {
    return listed;
  }

  const probed = await probeGscSiteUrl(token, site, range);
  if (probed) {
    return probed;
  }

  const claimed = await claimGscPrefixProperty(token, site, range);
  if (claimed) {
    return claimed;
  }

  throw new Error(
    "Service account is not a Search Console user on this property yet.",
  );
};

const organicMetricsFromGaRow = (
  row: NonNullable<RunReportResponse["rows"]>[number],
): { clicks: number; impressions: number; ctr: number; position: number } => {
  const clicks = Number(row.metricValues?.[0]?.value ?? 0);
  const impressions = Number(row.metricValues?.[1]?.value ?? 0);
  const ctr = Number(row.metricValues?.[2]?.value ?? 0);
  const position = Number(row.metricValues?.[3]?.value ?? 0);
  return { clicks, impressions, ctr, position };
};

const gaOrganicRowsToGsc = (
  rows: NonNullable<RunReportResponse["rows"]> = [],
): GscQueryResponse => ({
  rows: rows.map((row) => {
    const date = parseGaDate(row.dimensionValues?.[0]?.value ?? "");
    return { keys: [date], ...organicMetricsFromGaRow(row) };
  }),
});

const pickOrganicQueryDimension = (metadata: GaMetadata): string | null => {
  const dimensions = metadata.dimensions ?? [];
  const byUi = dimensions.find((item) =>
    /organic google search query/i.test(item.uiName ?? ""),
  );
  if (byUi?.apiName) return byUi.apiName;
  const byApi = dimensions.find((item) =>
    /organicGoogleSearchQuery/i.test(item.apiName ?? ""),
  );
  return byApi?.apiName ?? null;
};

const fetchGaOrganicQueries = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
): Promise<GscQueryResponse> => {
  try {
    const metadata = await fetchJson<GaMetadata>(
      `${DATA_BASE}/properties/${site.gaPropertyId}/metadata`,
      token,
    );
    const dimension = pickOrganicQueryDimension(metadata);
    if (!dimension) {
      return { rows: [] };
    }
    const report = await runGaReport(token, site.gaPropertyId, null, range, {
      dimensions: [{ name: dimension }],
      metrics: [
        { name: "organicGoogleSearchClicks" },
        { name: "organicGoogleSearchImpressions" },
        { name: "organicGoogleSearchClickThroughRate" },
        { name: "organicGoogleSearchAveragePosition" },
      ],
      orderBys: [
        { metric: { metricName: "organicGoogleSearchClicks" }, desc: true },
      ],
      limit: SUMMARY_ROW_LIMIT,
    });
    return {
      rows: (report.rows ?? []).map((row) => ({
        keys: [row.dimensionValues?.[0]?.value ?? "(not set)"],
        ...organicMetricsFromGaRow(row),
      })),
    };
  } catch {
    return { rows: [] };
  }
};

const fetchGaOrganicBundle = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
): Promise<GscBundle | null> => {
  try {
    const daily = await runGaReport(token, site.gaPropertyId, null, range, {
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "organicGoogleSearchClicks" },
        { name: "organicGoogleSearchImpressions" },
        { name: "organicGoogleSearchClickThroughRate" },
        { name: "organicGoogleSearchAveragePosition" },
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: DAILY_ROW_LIMIT,
    });
    const queries = await fetchGaOrganicQueries(token, site, range);
    return {
      daily: gaOrganicRowsToGsc(daily.rows),
      queries,
      gscSiteUrl: site.gscSiteUrl,
      via: "ga4",
    };
  } catch {
    return null;
  }
};

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
  listedGscSites: GscSiteEntry[] | null,
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
      (async (): Promise<GscBundle> => {
        const gscToken = await getGscToken();
        const gscSiteUrl = await resolveGscSiteUrl(
          gscToken,
          site,
          range,
          listedGscSites,
        );
        const [daily, queries] = await Promise.all([
          queryGsc(gscToken, gscSiteUrl, range, ["date"], DAILY_ROW_LIMIT),
          queryGsc(gscToken, gscSiteUrl, range, ["query"], SUMMARY_ROW_LIMIT),
        ]);
        return { daily, queries, gscSiteUrl, via: "searchconsole" };
      })(),
    ]);

  const gaErrorRaw =
    gaDailyResult.status === "rejected"
      ? gaDailyResult.reason instanceof Error
        ? gaDailyResult.reason.message
        : String(gaDailyResult.reason)
      : null;
  const gaDaily =
    gaDailyResult.status === "fulfilled" ? gaDailyResult.value.rows : [];
  const gaPages =
    gaPagesResult.status === "fulfilled" ? gaPagesResult.value.rows : [];
  const gaChannels =
    gaChannelsResult.status === "fulfilled" ? gaChannelsResult.value.rows : [];

  let gscBundle: GscBundle | null =
    gscResult.status === "fulfilled" ? gscResult.value : null;
  let gscErrorRaw =
    gscResult.status === "rejected"
      ? gscResult.reason instanceof Error
        ? gscResult.reason.message
        : String(gscResult.reason)
      : null;

  if (!gscBundle) {
    const gaOrganic = await fetchGaOrganicBundle(gaToken, site, range);
    if (gaOrganic) {
      gscBundle = gaOrganic;
      gscErrorRaw = null;
    }
  }

  const gaError = publicGoogleError(gaErrorRaw, "ga4");
  const gscError = publicGoogleError(gscErrorRaw, "gsc");
  const serviceAccountEmail = getPrivateKey().email;
  const gscDaily = gscBundle?.daily.rows ?? [];
  const gscQueries = gscBundle?.queries.rows ?? [];
  const resolvedGscSiteUrl = gscBundle?.gscSiteUrl ?? site.gscSiteUrl;
  const gscAvailable = Boolean(gscBundle);
  const gscVia = gscBundle?.via ?? null;
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
        value: resolvedGscSiteUrl,
        detail: gscAvailable
          ? gscVia === "ga4"
            ? "Live organic Google Search rows from the GA4 Search Console link."
            : "Live Search Console searchAnalytics rows."
          : `${gscError ?? "Search Console unavailable."} Add ${serviceAccountEmail} as a user on this Search Console property.`,
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
      ...(!gscAvailable
        ? [
            {
              label: "GSC user to add",
              value: serviceAccountEmail,
              detail:
                "Add this service account as a user on both Search Console domain properties, then Search Console metrics fill in automatically.",
            },
          ]
        : []),
    ],
    sources: {
      ga4: gaAvailable ? "connected" : "unavailable",
      gsc: gscAvailable ? "connected" : "unavailable",
      gscVia,
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
  let listedGscSites: GscSiteEntry[] | null = null;
  try {
    listedGscSites = await listGscSites(await getGscToken());
  } catch {
    listedGscSites = null;
  }
  const snapshots = await Promise.all(
    NJO_SITES.map((site) =>
      fetchSiteSnapshot(site, range, generatedAt, listedGscSites),
    ),
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
  ["njo-sites-report-v4"],
  { revalidate: 60 },
);

export const getCachedNjoSitesReport = (periodId: NjoPeriodId) =>
  readCachedNjoSitesReport(periodId);
