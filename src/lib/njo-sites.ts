import { JWT } from "google-auth-library";
import { unstable_cache } from "next/cache";
import {
  gscFirstImpressionDate,
  mergeOrganicHistoryWithNative,
  pickBestGscProbe,
  rankGscUrl,
  shouldPreferGaOrganic,
  type GscProbeCandidate,
} from "@/lib/njo-gsc-select";

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
