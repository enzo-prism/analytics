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
