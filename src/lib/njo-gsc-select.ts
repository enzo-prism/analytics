export type GscProbeCandidate = {
  siteUrl: string;
  impressions: number;
  startDate: string | null;
};

export type GscDateRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
};

export const rankGscUrl = (siteUrl: string, domain: string): number => {
  const lower = siteUrl.toLowerCase();
  if (lower === `sc-domain:${domain}`) return 0;
  if (lower === `https://www.${domain}/`) return 1;
  if (lower === `https://${domain}/`) return 2;
  if (lower.includes(domain)) return 3;
  return 99;
};

export const gscFirstImpressionDate = (
  rows: GscDateRow[] = [],
): string | null => {
  const dates = rows
    .filter(
      (row) => Number(row.impressions ?? 0) > 0 || Number(row.clicks ?? 0) > 0,
    )
    .map((row) => row.keys?.[0])
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates[0] ?? null;
};

export const pickBestGscProbe = (
  candidates: GscProbeCandidate[],
  domain: string,
): GscProbeCandidate | null => {
  const withTraffic = candidates.filter((candidate) => candidate.impressions > 0);
  const pool = withTraffic.length > 0 ? withTraffic : candidates;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const startA = a.startDate ?? "9999-99-99";
    const startB = b.startDate ?? "9999-99-99";
    if (startA !== startB) return startA.localeCompare(startB);
    if (b.impressions !== a.impressions) return b.impressions - a.impressions;
    return rankGscUrl(a.siteUrl, domain) - rankGscUrl(b.siteUrl, domain);
  })[0];
};

export const shouldPreferGaOrganic = (
  nativeStart: string | null,
  organicStart: string | null,
): boolean => {
  if (!organicStart) return false;
  if (!nativeStart) return true;
  return organicStart < nativeStart;
};

const gscRowHasTraffic = (row: GscDateRow): boolean =>
  Number(row.clicks ?? 0) > 0 || Number(row.impressions ?? 0) > 0;

/**
 * Keep the longer GA4 organic series, then overlay native Search Console days
 * that have traffic. URL-prefix data currently publishes a day ahead of the
 * GA4 organic link, and those days are the same numbers on the overlap.
 */
export const mergeOrganicHistoryWithNative = (
  organicRows: GscDateRow[] = [],
  nativeRows: GscDateRow[] = [],
): GscDateRow[] => {
  const byDate = new Map<string, GscDateRow>();
  for (const row of organicRows) {
    const date = row.keys?.[0];
    if (date) byDate.set(date, row);
  }
  for (const row of nativeRows) {
    const date = row.keys?.[0];
    if (!date || !gscRowHasTraffic(row)) continue;
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) =>
    (a.keys?.[0] ?? "").localeCompare(b.keys?.[0] ?? ""),
  );
};
