import { JWT } from "google-auth-library";
import { unstable_cache } from "next/cache";

const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const SITE_VERIFY_BASE = "https://www.googleapis.com/siteVerification/v1";
const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GSC_READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const SITE_VERIFY_SCOPE = "https://www.googleapis.com/auth/siteverification";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DNS_SCOPE = "https://www.googleapis.com/auth/ndev.clouddns.readwrite";
const REQUEST_TIMEOUT_MS = 25_000;
const HISTORICAL_FLOOR = "2024-01-01";
const DAILY_ROW_LIMIT = 5000;
const SUMMARY_ROW_LIMIT = 25;

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
  metaToken?: string | null;
  fileToken?: string | null;
  claimError?: string | null;
};

type GscClaimResult = {
  siteUrl: string | null;
  error: string | null;
  metaToken: string | null;
  fileToken: string | null;
};

type SiteVerificationMethod = "FILE" | "META" | "ANALYTICS" | "DNS_TXT";
type SiteVerificationSite = { type: "SITE" | "INET_DOMAIN"; identifier: string };

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
    [GSC_WRITE_SCOPE, SITE_VERIFY_SCOPE, CLOUD_PLATFORM_SCOPE, DNS_SCOPE],
    [GSC_WRITE_SCOPE, SITE_VERIFY_SCOPE, CLOUD_PLATFORM_SCOPE],
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

const gcpProjectId = (): string | null => {
  const email = process.env.GA_CLIENT_EMAIL ?? "";
  const match = email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/i);
  return match?.[1] ?? null;
};

const rawErrorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const publicClaimError = (error: unknown): string => {
  const text = rawErrorText(error);
  if (/accessNotConfigured|has not been used in project|is disabled/i.test(text)) {
    return "Site Verification API is not enabled on the Google Cloud project.";
  }
  if (/insufficient authentication scopes|invalid_scope/i.test(text)) {
    return "The service account is missing Site Verification scope.";
  }
  if (/FILE token|verification file/i.test(text)) {
    return text.slice(0, 240);
  }
  if (/necessary verification token could not be found/i.test(text)) {
    return "Google fetched the site but did not find this service account's verification token.";
  }
  if (/403|sufficient permission|forbidden/i.test(text)) {
    return "Search Console verification was denied for this service account.";
  }
  return "Search Console verification did not complete.";
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
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

const isUsableGscPermission = (level?: string): boolean => {
  if (!level) return true;
  return !/unverified/i.test(level);
};

const matchingGscEntries = (
  listedSites: GscSiteEntry[] | null,
  site: NjoSiteConfig,
): GscSiteEntry[] => {
  if (!listedSites) return [];
  const domain = site.domain.toLowerCase();
  return listedSites
    .filter((entry) => (entry.siteUrl ?? "").toLowerCase().includes(domain))
    .filter((entry) => isUsableGscPermission(entry.permissionLevel))
    .sort(
      (a, b) =>
        rankGscUrl(a.siteUrl ?? "", domain) - rankGscUrl(b.siteUrl ?? "", domain),
    );
};

const listedUrlsForSite = (
  listedSites: GscSiteEntry[] | null,
  site: NjoSiteConfig,
): string[] =>
  matchingGscEntries(listedSites, site)
    .map((entry) => entry.siteUrl)
    .filter((url): url is string => Boolean(url));

const probeGscSiteUrl = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
  preferred: string[] = [],
): Promise<string | null> => {
  const seen = new Set<string>();
  const candidates = [...preferred, ...gscCandidateUrls(site)].filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  let firstOk: string | null = null;
  for (const siteUrl of candidates) {
    try {
      const daily = await queryGsc(token, siteUrl, range, ["date"], DAILY_ROW_LIMIT);
      const impressions = (daily.rows ?? []).reduce(
        (total, row) => total + Number(row.impressions ?? 0),
        0,
      );
      if (impressions > 0) {
        console.info(`[njo-sites] ${site.id} GSC ${siteUrl} has ${impressions} impressions`);
        return siteUrl;
      }
      firstOk ??= siteUrl;
      console.info(`[njo-sites] ${site.id} GSC ${siteUrl} responded with no rows`);
    } catch (error) {
      console.info(
        `[njo-sites] ${site.id} GSC ${siteUrl} skipped`,
        rawErrorText(error).slice(0, 180),
      );
    }
  }
  return firstOk;
};

const canonicalPrefixUrl = (site: NjoSiteConfig): string =>
  `https://${site.domain.toLowerCase()}/`;

export const googleSiteVerificationBody = (filename: string): string =>
  `google-site-verification: ${filename}`;

export const normalizeFileVerificationName = (
  token: string,
): string | null => {
  const cleaned = token
    .replace(/^google-site-verification:\s*/i, "")
    .trim()
    .split(/[/\\?\s]/)[0];
  const value = cleaned?.split("/").pop() ?? "";
  if (/^google[a-z0-9]+\.html$/i.test(value)) return value;
  if (/^google[a-z0-9]+$/i.test(value)) return `${value}.html`;
  return null;
};

const liveVerificationFileReady = async (
  site: NjoSiteConfig,
  filename: string,
): Promise<boolean> => {
  const name = normalizeFileVerificationName(filename);
  if (!name) {
    return false;
  }
  const url = `${site.url.replace(/\/$/, "")}/${name}`;
  try {
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return false;
    }
    const body = (await response.text()).replace(/^\uFEFF/, "").replace(/\s+$/g, "");
    const expected = googleSiteVerificationBody(name);
    return (
      body === expected ||
      body === filename.trim() ||
      body.includes(expected) ||
      body.includes(`google-site-verification: ${name}`)
    );
  } catch {
    return false;
  }
};

const enableGoogleApi = async (
  token: string,
  service: string,
): Promise<void> => {
  const projectId = gcpProjectId();
  if (!projectId) return;
  try {
    await fetchJson(
      `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${service}:enable`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    // Viewer/analytics service accounts usually cannot enable APIs.
  }
};

const getSiteVerificationToken = async (
  token: string,
  site: SiteVerificationSite,
  method: SiteVerificationMethod,
): Promise<string> => {
  const data = await fetchJson<{ token?: string }>(
    `${SITE_VERIFY_BASE}/token`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site,
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
  site: SiteVerificationSite,
  method: SiteVerificationMethod,
): Promise<void> => {
  await fetchJson(
    `${SITE_VERIFY_BASE}/webResource?verificationMethod=${method}`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site }),
    },
  );
};

const addSearchConsoleSite = async (
  token: string,
  siteUrl: string,
): Promise<void> => {
  await fetchJson(`${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}`, token, {
    method: "PUT",
  });
};

const txtRecordValue = (token: string): string => {
  const value = token.trim().replace(/^"+|"+$/g, "");
  if (/^google-site-verification=/i.test(value)) return value;
  return `google-site-verification=${value}`;
};

const quotedTxt = (value: string): string =>
  `"${value.replaceAll('"', '\\"')}"`;

const addDomainTxtRecord = async (
  token: string,
  domain: string,
  txtValue: string,
): Promise<void> => {
  const projectId = gcpProjectId();
  if (!projectId) {
    throw new Error("No GCP project id on the service account email.");
  }
  const zones = await fetchJson<{
    managedZones?: { name?: string; dnsName?: string }[];
  }>(`https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones`, token, {
    signal: AbortSignal.timeout(8_000),
  });
  const needle = `${domain.toLowerCase()}.`;
  const zone = (zones.managedZones ?? []).find(
    (item) => (item.dnsName ?? "").toLowerCase() === needle,
  );
  if (!zone?.name) {
    throw new Error(`No Cloud DNS zone for ${domain} in ${projectId}.`);
  }
  const name = needle;
  const existing = await fetchJson<{
    rrsets?: { name?: string; type?: string; ttl?: number; rrdatas?: string[] }[];
  }>(
    `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones/${zone.name}/rrsets?name=${encodeURIComponent(name)}&type=TXT`,
    token,
  );
  const current =
    existing.rrsets?.find((item) => item.type === "TXT" && item.name === name) ??
    null;
  const nextValues = new Set(current?.rrdatas ?? []);
  nextValues.add(quotedTxt(txtValue));
  nextValues.add(txtValue);
  const rrdatas = [...nextValues];
  await fetchJson(
    `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones/${zone.name}/changes`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        additions: [{ name, type: "TXT", ttl: current?.ttl ?? 300, rrdatas }],
        deletions: current ? [current] : [],
      }),
    },
  );
};

const finishGscSite = async (
  token: string,
  site: NjoSiteConfig,
  siteUrl: string,
  range: { from: string; to: string },
): Promise<string> => {
  try {
    await addSearchConsoleSite(token, siteUrl);
  } catch {
    // Already present, or write scope is missing.
  }
  if (siteUrl.toLowerCase().startsWith("sc-domain:")) {
    try {
      await addSearchConsoleSite(token, site.gscSiteUrl);
    } catch {
      // Domain property still needs DNS verification.
    }
  }
  const listed = await listGscSites(token).catch(() => []);
  console.info(
    `[njo-sites] ${site.id} listed after claim`,
    listed
      .filter((entry) => (entry.siteUrl ?? "").toLowerCase().includes(site.domain))
      .map((entry) => `${entry.siteUrl}:${entry.permissionLevel ?? "unknown"}`),
  );
  return (
    (await probeGscSiteUrl(token, site, range, listedUrlsForSite(listed, site))) ??
    siteUrl
  );
};

const emptyClaim = (): GscClaimResult => ({
  siteUrl: null,
  error: null,
  metaToken: null,
  fileToken: null,
});

const claimGscProperty = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
): Promise<GscClaimResult> => {
  const prefix = canonicalPrefixUrl(site);
  const domainSite: SiteVerificationSite = {
    type: "INET_DOMAIN",
    identifier: site.domain.toLowerCase(),
  };
  const prefixSite: SiteVerificationSite = { type: "SITE", identifier: prefix };
  const errors: string[] = [];
  const claimed: GscClaimResult = emptyClaim();

  await enableGoogleApi(token, "siteverification.googleapis.com");
  await enableGoogleApi(token, "dns.googleapis.com");

  try {
    await insertVerifiedWebResource(token, prefixSite, "ANALYTICS");
    return {
      ...claimed,
      siteUrl: await finishGscSite(token, site, prefix, range),
    };
  } catch (error) {
    errors.push(`ANALYTICS: ${publicClaimError(error)}`);
    console.error(`[njo-sites] ${site.id} ANALYTICS verify failed`, rawErrorText(error));
  }

  try {
    const dnsToken = await getSiteVerificationToken(token, domainSite, "DNS_TXT");
    try {
      await addDomainTxtRecord(token, site.domain, txtRecordValue(dnsToken));
    } catch (error) {
      errors.push(`DNS write: ${publicClaimError(error)}`);
      console.error(`[njo-sites] ${site.id} DNS write failed`, rawErrorText(error));
    }
    await insertVerifiedWebResource(token, domainSite, "DNS_TXT");
    return {
      ...claimed,
      siteUrl: await finishGscSite(token, site, site.gscSiteUrl, range),
    };
  } catch (error) {
    errors.push(`DNS_TXT: ${publicClaimError(error)}`);
    console.error(`[njo-sites] ${site.id} DNS_TXT verify failed`, rawErrorText(error));
  }

  try {
    claimed.metaToken = await getSiteVerificationToken(token, prefixSite, "META");
    console.info(`[njo-sites] ${site.id} META token ${claimed.metaToken}`);
    await insertVerifiedWebResource(token, prefixSite, "META");
    return {
      ...claimed,
      siteUrl: await finishGscSite(token, site, prefix, range),
    };
  } catch (error) {
    errors.push(`META: ${publicClaimError(error)}`);
    console.error(`[njo-sites] ${site.id} META verify failed`, rawErrorText(error));
  }

  try {
    claimed.fileToken = await getSiteVerificationToken(token, prefixSite, "FILE");
    console.info(`[njo-sites] ${site.id} FILE token ${claimed.fileToken}`);
    const filename = normalizeFileVerificationName(claimed.fileToken);
    if (!filename) {
      throw new Error(`FILE token was not a google*.html name.`);
    }
    const ready = await liveVerificationFileReady(site, filename);
    if (!ready) {
      throw new Error(`Verification file ${filename} is not live on ${site.domain}.`);
    }
    await insertVerifiedWebResource(token, prefixSite, "FILE");
    return {
      ...claimed,
      siteUrl: await finishGscSite(token, site, prefix, range),
    };
  } catch (error) {
    errors.push(`FILE: ${publicClaimError(error)}`);
    console.error(`[njo-sites] ${site.id} FILE verify failed`, rawErrorText(error));
  }

  return {
    ...claimed,
    error: errors.at(-1) ?? publicClaimError("unverified"),
  };
};

const resolveGscSiteUrl = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
  listedSites: GscSiteEntry[] | null,
): Promise<GscClaimResult> => {
  const listedUrls = listedUrlsForSite(listedSites, site);
  if (listedSites?.length) {
    console.info(
      `[njo-sites] ${site.id} listed`,
      matchingGscEntries(listedSites, site).map(
        (entry) => `${entry.siteUrl}:${entry.permissionLevel ?? "unknown"}`,
      ),
    );
  }
  const probed = await probeGscSiteUrl(token, site, range, listedUrls);
  if (probed) {
    return { ...emptyClaim(), siteUrl: probed };
  }

  const claimed = await claimGscProperty(token, site, range);
  if (claimed.siteUrl) {
    return claimed;
  }

  return {
    ...claimed,
    siteUrl: null,
    error:
      claimed.error ??
      "Service account is not a Search Console user on this property yet.",
  };
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
  const byApi = dimensions.find((item) =>
    /^(searchQuery|organicGoogleSearchQuery)$/i.test(item.apiName ?? ""),
  );
  if (byApi?.apiName) return byApi.apiName;
  const byUi = dimensions.find((item) =>
    /(organic google search query|search query)/i.test(item.uiName ?? ""),
  );
  return byUi?.apiName ?? null;
};

const fetchGaOrganicQueries = async (
  token: string,
  site: NjoSiteConfig,
  range: { from: string; to: string },
): Promise<GscQueryResponse> => {
  const candidates = new Set<string>(["searchQuery", "organicGoogleSearchQuery"]);
  try {
    const metadata = await fetchJson<GaMetadata>(
      `${DATA_BASE}/properties/${site.gaPropertyId}/metadata`,
      token,
    );
    const dimension = pickOrganicQueryDimension(metadata);
    if (dimension) candidates.add(dimension);
  } catch {
    // Metadata is optional; try the Search Console dimension names directly.
  }

  for (const dimension of candidates) {
    try {
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
      if (report.rows?.length) {
        return {
          rows: report.rows.map((row) => ({
            keys: [row.dimensionValues?.[0]?.value ?? "(not set)"],
            ...organicMetricsFromGaRow(row),
          })),
        };
      }
    } catch {
      continue;
    }
  }
  return { rows: [] };
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
        const resolved = await resolveGscSiteUrl(
          gscToken,
          site,
          range,
          listedGscSites,
        );
        const tryUrls = [
          resolved.siteUrl,
          ...listedUrlsForSite(listedGscSites, site),
          ...gscCandidateUrls(site),
        ].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);
        let lastError = resolved.error;
        for (const siteUrl of tryUrls) {
          try {
            const [daily, queries] = await Promise.all([
              queryGsc(gscToken, siteUrl, range, ["date"], DAILY_ROW_LIMIT),
              queryGsc(gscToken, siteUrl, range, ["query"], SUMMARY_ROW_LIMIT),
            ]);
            console.info(
              `[njo-sites] ${site.id} native GSC ${siteUrl} queries=${queries.rows?.length ?? 0}`,
            );
            return {
              daily,
              queries,
              gscSiteUrl: siteUrl,
              via: "searchconsole",
              metaToken: resolved.metaToken,
              fileToken: resolved.fileToken,
            };
          } catch (error) {
            lastError = publicClaimError(error);
            console.info(
              `[njo-sites] ${site.id} native GSC ${siteUrl} failed`,
              rawErrorText(error).slice(0, 180),
            );
          }
        }
        return {
          daily: { rows: [] },
          queries: { rows: [] },
          gscSiteUrl: site.gscSiteUrl,
          via: "ga4",
          metaToken: resolved.metaToken,
          fileToken: resolved.fileToken,
          claimError: lastError,
        };
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
  const gscMetaToken = gscBundle?.metaToken ?? null;
  const gscFileToken = gscBundle?.fileToken ?? null;
  const gscErrorRaw =
    gscResult.status === "rejected"
      ? gscResult.reason instanceof Error
        ? gscResult.reason.message
        : String(gscResult.reason)
      : gscBundle?.via === "searchconsole"
        ? null
        : (gscBundle?.claimError ?? null);
  const nativeSearch = gscBundle?.via === "searchconsole" ? gscBundle : null;
  const nativeSearchTotals = nativeSearch
    ? sumSearchRows(nativeSearch.daily.rows)
    : null;
  const nativeHasQueries = (nativeSearch?.queries.rows?.length ?? 0) > 0;
  const nativeHasTraffic = (nativeSearchTotals?.impressions ?? 0) > 0;

  if (!gscBundle || gscBundle.via !== "searchconsole" || !nativeHasTraffic) {
    const gaOrganic = await fetchGaOrganicBundle(gaToken, site, range);
    if (gaOrganic) {
      gscBundle = {
        ...(nativeHasQueries
          ? { ...gaOrganic, queries: nativeSearch!.queries, via: "searchconsole" }
          : gaOrganic),
        metaToken: gscMetaToken,
        fileToken: gscFileToken,
        claimError: gscErrorRaw,
      };
    }
  }

  const gaError = publicGoogleError(gaErrorRaw, "ga4");
  const gscClaimError =
    gscBundle?.claimError ?? (gscErrorRaw ? publicClaimError(gscErrorRaw) : null);
  const gscError = publicGoogleError(
    gscBundle ? null : gscErrorRaw,
    "gsc",
  );
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
            ? "Live organic Google Search clicks and impressions from the GA4 Search Console link. Query rows need native Search Console access."
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
      ...(!gscAvailable || (gscVia === "ga4" && gscQueries.length === 0)
        ? [
            {
              label: "GSC user to add",
              value: serviceAccountEmail,
              detail:
                gscClaimError ??
                "Add this service account as a user on both Search Console domain properties to load query rows.",
            },
            ...(gscMetaToken
              ? [
                  {
                    label: "GSC meta token",
                    value: gscMetaToken,
                    detail:
                      "Homepage google-site-verification meta content for this service account.",
                  },
                ]
              : []),
            ...(gscFileToken
              ? [
                  {
                    label: "GSC file token",
                    value: gscFileToken,
                    detail:
                      "Root google*.html verification file name for this service account.",
                  },
                ]
              : []),
          ]
        : []),
    ],
    sources: {
      ga4: gaAvailable ? "connected" : "unavailable",
      gsc: gscAvailable ? "connected" : "unavailable",
      gscVia,
      gaError,
      gscError,
      gscClaimError,
      gscMetaToken,
      gscFileToken,
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
  ["njo-sites-report-v7"],
  { revalidate: 60 },
);

export const getCachedNjoSitesReport = (periodId: NjoPeriodId) =>
  readCachedNjoSitesReport(periodId);
