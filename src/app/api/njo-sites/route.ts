import { NextResponse } from "next/server";
import {
  getCachedNjoSitesReport,
  isNjoPeriodId,
  type NjoPeriodId,
} from "@/lib/njo-sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_ORIGINS = new Set([
  "https://njo-dashboard.vercel.app",
  "https://njo-dashboard-enzo-design-prisms-projects.vercel.app",
  "https://njo-dashboard-git-main-enzo-design-prisms-projects.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const isAllowedOrigin = (origin: string | null): origin is string => {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https:\/\/njo-dashboard(?:-git-[\w-]+)?-enzo-design-prisms-projects\.vercel\.app$/.test(
    origin,
  );
};

const corsHeaders = (origin: string | null): HeadersInit => {
  const headers: Record<string, string> = {
    "Cache-Control": "s-maxage=60, stale-while-revalidate=86400",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
};

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const { searchParams } = new URL(request.url);
  const periodParam = searchParams.get("period") ?? "last30";
  const periodId: NjoPeriodId = isNjoPeriodId(periodParam)
    ? periodParam
    : "last30";

  try {
    const data = await getCachedNjoSitesReport(periodId);
    return NextResponse.json(data, { headers: corsHeaders(origin) });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to load Njo/PTI website analytics.";
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: {
          ...corsHeaders(origin),
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
