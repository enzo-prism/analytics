import type { DashboardWindow } from "@/lib/types";

export type TrendTone = "neutral" | "positive" | "negative" | "critical";

type TrendMeasurement = {
  current: number;
  previous: number;
  delta: number;
  pct: number | null;
};

const WINDOW_DAYS: Record<DashboardWindow, number> = {
  d1: 1,
  d7: 7,
  d28: 28,
  d90: 90,
  d180: 180,
  d365: 365,
};

const MATERIALITY_EPSILON = 1e-9;

/**
 * Classifies a trend using both rate and portfolio-impact gates. Absolute
 * counts are normalized to a seven-day rate so every reporting window uses
 * the same materiality standard.
 */
export const classifyTrend = (
  measurement: TrendMeasurement,
  windowKey: DashboardWindow,
): TrendTone => {
  const sevenDayScale = 7 / WINDOW_DAYS[windowKey];
  const normalizedDelta = measurement.delta * sevenDayScale;
  const normalizedPrevious = measurement.previous * sevenDayScale;

  if (
    (measurement.pct !== null &&
      measurement.pct <= -0.4 &&
      normalizedDelta <= -20 + MATERIALITY_EPSILON) ||
    (measurement.current === 0 &&
      normalizedPrevious >= 10 - MATERIALITY_EPSILON)
  ) {
    return "critical";
  }

  if (
    measurement.pct !== null &&
    measurement.pct <= -0.2 &&
    normalizedDelta <= -10 + MATERIALITY_EPSILON
  ) {
    return "negative";
  }

  if (
    measurement.pct !== null &&
    measurement.pct >= 0.15 &&
    normalizedDelta >= 10 - MATERIALITY_EPSILON
  ) {
    return "positive";
  }

  return "neutral";
};
