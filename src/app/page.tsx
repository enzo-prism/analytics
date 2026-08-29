import DashboardClient from "./dashboard-client";
import { getCachedDashboardData } from "@/lib/ga";
import type { DashboardResponse } from "@/lib/types";

export const revalidate = 60;

export default async function Home() {
  let initialData: DashboardResponse | null = null;

  try {
    initialData = await getCachedDashboardData("d7");
  } catch {
    // Keep the shell available when GA credentials or the API are unavailable.
    // The client retries through the cached route handler after hydration.
  }

  return <DashboardClient initialData={initialData} />;
}
