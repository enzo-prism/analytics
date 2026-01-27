import { NextResponse } from "next/server";
import { getTotalNewUsers } from "@/lib/ga";
import type { TotalWindow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_VALUES: TotalWindow[] = ["d30", "d60", "d90", "d365"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const windowParam = searchParams.get("window") ?? "d30";
  const windowKey = WINDOW_VALUES.includes(windowParam as TotalWindow)
    ? (windowParam as TotalWindow)
    : "d30";

  try {
    const data = await getTotalNewUsers(windowKey);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to load total new users.";
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
