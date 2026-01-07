import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/ga";
import type { DashboardWindow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_VALUES: DashboardWindow[] = ["d1", "d7", "d28"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const windowParam = searchParams.get("window") ?? "d7";
  const windowKey = WINDOW_VALUES.includes(windowParam as DashboardWindow)
    ? (windowParam as DashboardWindow)
    : "d7";

  try {
    const data = await getDashboardData(windowKey);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to load dashboard data.";
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
