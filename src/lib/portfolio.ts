import { unstable_cache } from "next/cache";
import { getCachedDashboardData as getGaDashboard, getCachedPropertyDetail as getGaDetail } from "@/lib/ga";
import { TRACKED_PROJECTS, findTrackedProject } from "@/lib/tracked-projects";
import { getVercelDashboardProperty, getVercelProjectDetail } from "@/lib/vercel-analytics";
import type { DashboardProperty, DashboardResponse, DashboardWindow } from "@/lib/types";

const hostname = (url: string | null) => {
  try { return new URL(url ?? "").hostname.replace(/^www\./, ""); } catch { return null; }
};

export function mergeTrackedProjects(ga: DashboardProperty[], vercel: DashboardProperty[]) {
  // A site's selected source wins, even if GA discovery later finds another property.
  const vercelHosts = new Set(TRACKED_PROJECTS.filter(p => !p.gaPropertyId).map(p => hostname(p.url)));
  return [...ga.filter(p => !vercelHosts.has(hostname(p.defaultUri))).map(p => {
    const project = findTrackedProject(p.propertyId);
    return {
      ...p, source: "ga4" as const, metric: "newUsers" as const,
      ...(project ? { displayName: project.name, defaultUri: project.url,
        error: p.error && /403|permission|forbidden/i.test(p.error) ? "Google Analytics access is unavailable. Grant the dashboard service account Viewer access to this property." : p.error } : {}),
    };
  }), ...vercel];
}

async function getPortfolio(window: DashboardWindow): Promise<DashboardResponse> {
  const [ga, vercel] = await Promise.all([
    getGaDashboard(window).catch(() => null),
    Promise.all(TRACKED_PROJECTS.filter(p => !p.gaPropertyId).map(p => getVercelDashboardProperty(p, window))),
  ]);
  if (!ga && vercel.every(p => p.error)) throw new Error("Analytics sources are unavailable.");
  const gaRows = ga?.properties ?? TRACKED_PROJECTS.filter(p => p.gaPropertyId).map(p => ({
    propertyId: p.gaPropertyId!, displayName: p.name, defaultUri: p.url, emoji: "", newUsers: null,
    error: "Google Analytics is temporarily unavailable.",
  }));
  return { updatedAt: ga?.updatedAt ?? new Date().toISOString(), window,
    ...(!ga ? { sourceWarning: "Google Analytics is unavailable. Only Vercel results are reporting; other websites will return when the connection recovers." } : {}),
    properties: mergeTrackedProjects(gaRows, vercel) };
}

export const getCachedDashboardData = unstable_cache(getPortfolio, ["portfolio-dashboard-v1"], { revalidate: 60 });
export const getCachedPropertyDetail = unstable_cache(async (id: string, window: DashboardWindow) => {
  const project = findTrackedProject(id);
  if (project && !project.gaPropertyId) return getVercelProjectDetail(project, window);
  const detail = await getGaDetail(id, window);
  if (!project) return detail;
  return { ...detail, property: { ...detail.property, displayName: project.name, defaultUri: project.url, source: "ga4" as const, metric: "newUsers" as const },
    error: detail.error && /403|permission|forbidden/i.test(detail.error) ? "Google Analytics access is unavailable. Grant the dashboard service account Viewer access to this property." : detail.error };
}, ["portfolio-detail-v1"], { revalidate: 60 });
