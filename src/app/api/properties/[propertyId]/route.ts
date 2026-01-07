import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPropertyDetail } from "@/lib/ga";
import type { DashboardWindow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_VALUES: DashboardWindow[] = [
  "d1",
  "d7",
  "d28",
  "d90",
  "d180",
  "d365",
];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ propertyId: string }> },
) {
  const { searchParams } = new URL(request.url);
  const windowParam = searchParams.get("window") ?? "d7";
  const windowKey = WINDOW_VALUES.includes(windowParam as DashboardWindow)
    ? (windowParam as DashboardWindow)
    : "d7";
  const { propertyId } = await context.params;

  if (!propertyId) {
    return NextResponse.json(
      { error: "Property id is required." },
      { status: 400 },
    );
  }

  const data = await getPropertyDetail(propertyId, windowKey);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
    },
  });
}
