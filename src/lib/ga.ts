import { JWT } from "google-auth-library";
import type {
  DashboardProperty,
  DashboardResponse,
  DashboardWindow,
  NewUsersDelta,
  PropertyDetailResponse,
  PropertySeriesPoint,
} from "@/lib/types";

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];
const WINDOW_DAYS: Record<DashboardWindow, number> = {
  d1: 1,
  d7: 7,
  d28: 28,
};
const DEFAULT_BLOCKLIST = new Set(["508295014"]);

type PropertySummary = {
  propertyId: string;
  displayName: string;
};

type WebStreamInfo = {
  defaultUri: string | null;
  measurementId: string | null;
};

type PropertyResponse = {
  displayName?: string;
};

type DateRange = {
  startDate: string;
  endDate: string;
};

type AccountSummariesResponse = {
  accountSummaries?: {
    propertySummaries?: {
      property?: string;
      displayName?: string;
    }[];
  }[];
  nextPageToken?: string;
};

type DataStreamsResponse = {
  dataStreams?: {
    type?: string;
    webStreamData?: {
      defaultUri?: string;
      measurementId?: string;
    };
  }[];
  nextPageToken?: string;
};

type RunReportResponse = {
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
};

type SeriesRow = {
  date: string;
  value: number;
};

type StreamResult = {
  summary: PropertySummary;
  webStream: WebStreamInfo | null;
  error: string | null;
};

const DEFAULT_ERROR = "Unexpected response from Google APIs.";

const withErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return DEFAULT_ERROR;
};

const addDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
};

const formatDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeUri = (value: string): string =>
  value.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();

const parseDateDimension = (value: string): string => {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const parseIsoDate = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const buildDateList = (startDate: string, days: number): string[] => {
  const start = parseIsoDate(startDate);
  return Array.from({ length: days }, (_, index) =>
    formatDate(addDays(start, index)),
  );
};

const getDateRanges = (windowKey: DashboardWindow): {
  current: DateRange;
  previous: DateRange;
} => {
  const days = WINDOW_DAYS[windowKey];
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const currentEnd = addDays(todayUtc, -1);
  const currentStart = addDays(currentEnd, -(days - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(days - 1));

  return {
    current: {
      startDate: formatDate(currentStart),
      endDate: formatDate(currentEnd),
    },
    previous: {
      startDate: formatDate(previousStart),
      endDate: formatDate(previousEnd),
    },
  };
};

const getAllowlist = (): Set<string> | null => {
  const raw = process.env.GA_PROPERTY_ALLOWLIST;
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
};

const getBlocklist = (): Set<string> => {
  const raw = process.env.GA_PROPERTY_BLOCKLIST;
  if (!raw) return new Set(DEFAULT_BLOCKLIST);
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_BLOCKLIST, ...ids]);
};

const getAccessToken = async (): Promise<string> => {
  const clientEmail = process.env.GA_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GA_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      "Missing GA_CLIENT_EMAIL or GA_PRIVATE_KEY environment variables.",
    );
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const client = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });
  const { access_token: accessToken } = await client.authorize();
  if (!accessToken) {
    throw new Error("Unable to authorize the Google Analytics service account.");
  }
  return accessToken;
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
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    const suffix = detail ? ` ${detail}` : "";
    throw new Error(
      `Google API error ${response.status} ${response.statusText}.${suffix}`,
    );
  }

  return (await response.json()) as T;
};

const listPropertySummaries = async (
  token: string,
): Promise<PropertySummary[]> => {
  const summaries: PropertySummary[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${ADMIN_BASE}/accountSummaries`);
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const data = await fetchJson<AccountSummariesResponse>(
      url.toString(),
      token,
    );
    for (const accountSummary of data.accountSummaries ?? []) {
      for (const propertySummary of accountSummary.propertySummaries ?? []) {
        const propertyName = propertySummary.property ?? "";
        const propertyId = propertyName.split("/").pop();
        if (!propertyId) {
          continue;
        }
        summaries.push({
          propertyId,
          displayName: propertySummary.displayName ?? propertyId,
        });
      }
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return summaries;
};

const listDataStreams = async (
  token: string,
  propertyId: string,
): Promise<NonNullable<DataStreamsResponse["dataStreams"]>> => {
  const streams: NonNullable<DataStreamsResponse["dataStreams"]> = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${ADMIN_BASE}/properties/${propertyId}/dataStreams`);
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    const data = await fetchJson<DataStreamsResponse>(url.toString(), token);
    streams.push(...(data.dataStreams ?? []));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return streams;
};

const pickWebStream = (
  streams: NonNullable<DataStreamsResponse["dataStreams"]>,
): WebStreamInfo | null => {
  const webStreams = streams.filter(
    (stream) => stream.type === "WEB_DATA_STREAM" || stream.webStreamData,
  );
  if (!webStreams.length) {
    return null;
  }
  const preferred =
    webStreams.find((stream) => stream.webStreamData?.defaultUri) ??
    webStreams[0];
  return {
    defaultUri: preferred.webStreamData?.defaultUri ?? null,
    measurementId: preferred.webStreamData?.measurementId ?? null,
  };
};

const getPropertyMetadata = async (
  token: string,
  propertyId: string,
): Promise<PropertyDetailResponse["property"]> => {
  const property = await fetchJson<PropertyResponse>(
    `${ADMIN_BASE}/properties/${propertyId}`,
    token,
  );
  const streams = await listDataStreams(token, propertyId);
  const webStream = pickWebStream(streams);
  return {
    propertyId,
    displayName: property.displayName ?? propertyId,
    defaultUri: webStream?.defaultUri ?? null,
  };
};

const fetchNewUsers = async (
  token: string,
  propertyId: string,
  ranges: { current: DateRange; previous: DateRange },
): Promise<NewUsersDelta> => {
  const url = `${DATA_BASE}/properties/${propertyId}:runReport`;
  const body = {
    dateRanges: [ranges.current, ranges.previous],
    metrics: [{ name: "newUsers" }],
  };

  const data = await fetchJson<RunReportResponse>(url, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let current = 0;
  let previous = 0;
  const rows = data.rows ?? [];

  for (const row of rows) {
    const label = row.dimensionValues?.[0]?.value;
    const value = Number(row.metricValues?.[0]?.value ?? 0);
    if (label === "date_range_0") {
      current = value;
    } else if (label === "date_range_1") {
      previous = value;
    }
  }

  if (!rows.length) {
    current = 0;
    previous = 0;
  } else if (rows.length === 1 && !rows[0].dimensionValues?.length) {
    const values = rows[0].metricValues ?? [];
    if (values.length >= 2) {
      current = Number(values[0]?.value ?? 0);
      previous = Number(values[1]?.value ?? 0);
    }
  }

  const delta = current - previous;
  const pct = previous === 0 ? null : delta / previous;

  return { current, previous, delta, pct };
};

const fetchNewUsersSeries = async (
  token: string,
  propertyId: string,
  range: DateRange,
): Promise<SeriesRow[]> => {
  const url = `${DATA_BASE}/properties/${propertyId}:runReport`;
  const body = {
    dateRanges: [range],
    metrics: [{ name: "newUsers" }],
    dimensions: [{ name: "date" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
  };

  const data = await fetchJson<RunReportResponse>(url, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return (data.rows ?? []).map((row) => ({
    date: parseDateDimension(row.dimensionValues?.[0]?.value ?? ""),
    value: Number(row.metricValues?.[0]?.value ?? 0),
  }));
};

const buildSeries = (
  currentRange: DateRange,
  previousRange: DateRange,
  currentRows: SeriesRow[],
  previousRows: SeriesRow[],
  days: number,
): {
  series: PropertySeriesPoint[];
  currentTotal: number;
  previousTotal: number;
} => {
  const currentDates = buildDateList(currentRange.startDate, days);
  const previousDates = buildDateList(previousRange.startDate, days);
  const currentMap = new Map(currentRows.map((row) => [row.date, row.value]));
  const previousMap = new Map(previousRows.map((row) => [row.date, row.value]));

  const series = currentDates.map((date, index) => ({
    date,
    current: currentMap.get(date) ?? 0,
    previous: previousMap.get(previousDates[index]) ?? 0,
  }));

  const currentTotal = series.reduce((sum, point) => sum + point.current, 0);
  const previousTotal = series.reduce((sum, point) => sum + point.previous, 0);

  return { series, currentTotal, previousTotal };
};

const runLimited = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) {
          break;
        }
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(runners);
  return results;
};

export const getDashboardData = async (
  windowKey: DashboardWindow,
): Promise<DashboardResponse> => {
  const token = await getAccessToken();
  const ranges = getDateRanges(windowKey);
  const allowlist = getAllowlist();
  const blocklist = getBlocklist();

  const summaries = await listPropertySummaries(token);
  let filteredSummaries = allowlist
    ? summaries.filter((summary) => allowlist.has(summary.propertyId))
    : summaries;
  filteredSummaries = filteredSummaries.filter(
    (summary) => !blocklist.has(summary.propertyId),
  );

  const streamResults = await runLimited(
    filteredSummaries,
    5,
    async (summary): Promise<StreamResult | null> => {
      try {
        const streams = await listDataStreams(token, summary.propertyId);
        const webStream = pickWebStream(streams);
        if (!webStream) {
          return null;
        }
        return { summary, webStream, error: null };
      } catch (error) {
        return { summary, webStream: null, error: withErrorMessage(error) };
      }
    },
  );

  const errorRows: DashboardProperty[] = [];
  const reportTargets: StreamResult[] = [];

  for (const result of streamResults) {
    if (!result) {
      continue;
    }
    if (result.error) {
      errorRows.push({
        propertyId: result.summary.propertyId,
        displayName: result.summary.displayName,
        defaultUri: null,
        newUsers: null,
        error: result.error,
      });
      continue;
    }
    reportTargets.push(result);
  }

  const reportRows = await runLimited(
    reportTargets,
    5,
    async (result): Promise<DashboardProperty> => {
      try {
        const newUsers = await fetchNewUsers(
          token,
          result.summary.propertyId,
          ranges,
        );
        return {
          propertyId: result.summary.propertyId,
          displayName: result.summary.displayName,
          defaultUri: result.webStream?.defaultUri ?? null,
          newUsers,
          error: null,
        };
      } catch (error) {
        return {
          propertyId: result.summary.propertyId,
          displayName: result.summary.displayName,
          defaultUri: result.webStream?.defaultUri ?? null,
          newUsers: null,
          error: withErrorMessage(error),
        };
      }
    },
  );

  const sortedProperties = [...reportRows, ...errorRows].sort((a, b) => {
    const aValue = a.newUsers?.current ?? -1;
    const bValue = b.newUsers?.current ?? -1;
    return bValue - aValue;
  });

  const dedupedProperties: DashboardProperty[] = [];
  const seenDomains = new Set<string>();
  for (const property of sortedProperties) {
    if (!property.defaultUri) {
      dedupedProperties.push(property);
      continue;
    }
    const key = normalizeUri(property.defaultUri);
    if (seenDomains.has(key)) {
      continue;
    }
    seenDomains.add(key);
    dedupedProperties.push(property);
  }

  return {
    updatedAt: new Date().toISOString(),
    window: windowKey,
    properties: dedupedProperties,
  };
};

export const getPropertyDetail = async (
  propertyId: string,
  windowKey: DashboardWindow,
): Promise<PropertyDetailResponse> => {
  const allowlist = getAllowlist();
  const blocklist = getBlocklist();
  const updatedAt = new Date().toISOString();
  const fallbackProperty: PropertyDetailResponse["property"] = {
    propertyId,
    displayName: propertyId,
    defaultUri: null,
  };

  if (blocklist.has(propertyId)) {
    return {
      updatedAt,
      window: windowKey,
      property: fallbackProperty,
      summary: null,
      series: [],
      error: "Property is excluded from the dashboard.",
    };
  }

  if (allowlist && !allowlist.has(propertyId)) {
    return {
      updatedAt,
      window: windowKey,
      property: fallbackProperty,
      summary: null,
      series: [],
      error: "Property is not included in GA_PROPERTY_ALLOWLIST.",
    };
  }

  const token = await getAccessToken();
  const ranges = getDateRanges(windowKey);
  const days = WINDOW_DAYS[windowKey];

  let property = fallbackProperty;
  try {
    property = await getPropertyMetadata(token, propertyId);
  } catch (error) {
    return {
      updatedAt,
      window: windowKey,
      property,
      summary: null,
      series: [],
      error: withErrorMessage(error),
    };
  }

  try {
    const [currentRows, previousRows] = await Promise.all([
      fetchNewUsersSeries(token, propertyId, ranges.current),
      fetchNewUsersSeries(token, propertyId, ranges.previous),
    ]);
    const { series, currentTotal, previousTotal } = buildSeries(
      ranges.current,
      ranges.previous,
      currentRows,
      previousRows,
      days,
    );
    const delta = currentTotal - previousTotal;
    const pct = previousTotal === 0 ? null : delta / previousTotal;

    return {
      updatedAt,
      window: windowKey,
      property,
      summary: {
        current: currentTotal,
        previous: previousTotal,
        delta,
        pct,
      },
      series,
      error: null,
    };
  } catch (error) {
    return {
      updatedAt,
      window: windowKey,
      property,
      summary: null,
      series: [],
      error: withErrorMessage(error),
    };
  }
};
