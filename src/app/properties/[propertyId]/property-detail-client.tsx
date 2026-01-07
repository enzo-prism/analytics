"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardWindow, PropertyDetailResponse } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const WINDOW_OPTIONS: {
  value: DashboardWindow;
  label: string;
  shortLabel: string;
}[] = [
  { value: "d1", label: "1 day", shortLabel: "1d" },
  { value: "d7", label: "7 days", shortLabel: "7d" },
  { value: "d28", label: "28 days", shortLabel: "28d" },
  { value: "d90", label: "90 days", shortLabel: "90d" },
  { value: "d180", label: "180 days", shortLabel: "180d" },
  { value: "d365", label: "1 year", shortLabel: "1y" },
];

const WINDOW_VALUES: DashboardWindow[] = [
  "d1",
  "d7",
  "d28",
  "d90",
  "d180",
  "d365",
];

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const updatedFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const chartConfig = {
  current: {
    label: "Current window",
    color: "hsl(222 70% 50%)",
  },
  previous: {
    label: "Previous window",
    color: "hsl(173 58% 39%)",
  },
} satisfies ChartConfig;

const formatDomain = (value: string) =>
  value.replace(/^https?:\/\//, "").replace(/\/$/, "");

const formatShortDate = (value: string) => {
  if (!value) return value;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return dateFormatter.format(date);
};

type PropertyDetailClientProps = {
  propertyId: string;
};

export default function PropertyDetailClient({
  propertyId,
}: PropertyDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialWindow = useMemo(() => {
    const value = searchParams.get("window") ?? "d7";
    return WINDOW_VALUES.includes(value as DashboardWindow)
      ? (value as DashboardWindow)
      : "d7";
  }, [searchParams]);
  const [windowKey, setWindowKey] = useState<DashboardWindow>(initialWindow);
  const [data, setData] = useState<PropertyDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadProperty = useCallback(
    async (nextWindow: DashboardWindow) => {
      if (!propertyId) {
        setError("Missing property id.");
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/properties/${propertyId}?window=${nextWindow}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const message =
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to load property data.";
          throw new Error(message);
        }

        if (!payload) {
          throw new Error("Empty response from the property API.");
        }

        if (requestId === requestIdRef.current) {
          const parsed = payload as PropertyDetailResponse;
          setData(parsed);
          setError(parsed.error ?? null);
        }
      } catch (fetchError) {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        if (requestId === requestIdRef.current) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Failed to load property data.",
          );
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [propertyId],
  );

  useEffect(() => {
    setWindowKey(initialWindow);
  }, [initialWindow]);

  useEffect(() => {
    const currentParam = searchParams.get("window");
    if (currentParam !== windowKey) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("window", windowKey);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [router, searchParams, windowKey]);

  useEffect(() => {
    loadProperty(windowKey);
  }, [loadProperty, windowKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadProperty(windowKey);
    }, 60000);
    return () => clearInterval(interval);
  }, [loadProperty, windowKey]);

  const windowMeta =
    WINDOW_OPTIONS.find((option) => option.value === windowKey) ??
    WINDOW_OPTIONS[1];

  const updatedAt = data?.updatedAt
    ? updatedFormatter.format(new Date(data.updatedAt))
    : "Not loaded";

  const summary = data?.summary;
  const series = data?.series ?? [];

  const statCards = [
    {
      label: `Current (${windowMeta.shortLabel})`,
      value:
        summary?.current !== undefined
          ? numberFormatter.format(summary.current)
          : null,
    },
    {
      label: "Previous",
      value:
        summary?.previous !== undefined
          ? numberFormatter.format(summary.previous)
          : null,
    },
    {
      label: "Delta",
      value:
        summary?.delta !== undefined
          ? `${summary.delta > 0 ? "+" : ""}${numberFormatter.format(
              summary.delta,
            )}`
          : null,
      tone:
        summary?.delta !== undefined
          ? summary.delta >= 0
            ? "text-emerald-600"
            : "text-rose-600"
          : "text-muted-foreground",
    },
    {
      label: "Percent",
      value:
        summary?.pct !== undefined && summary?.pct !== null
          ? `${summary.pct > 0 ? "+" : ""}${percentFormatter.format(
              summary.pct,
            )}`
          : "n/a",
      tone:
        summary?.pct !== undefined && summary?.pct !== null
          ? summary.pct >= 0
            ? "text-emerald-600"
            : "text-rose-600"
          : "text-muted-foreground",
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Property detail</Badge>
              <Badge variant="outline">ID {propertyId}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {data?.property.emoji ?? "✨"}
              </span>
              <h1 className="font-display text-2xl tracking-tight text-foreground sm:text-4xl">
                {data?.property.displayName ?? "Loading property..."}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground sm:text-base">
              {data?.property.defaultUri
                ? formatDomain(data.property.defaultUri)
                : "Domain unavailable"}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <span className="text-xs text-muted-foreground">
            Last updated: {updatedAt}
          </span>
          <Button onClick={() => loadProperty(windowKey)} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Property error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>Window</CardTitle>
            <CardDescription>
              Compare {windowMeta.label} ending yesterday with the previous
              window.
            </CardDescription>
          </div>
          <div className="w-full max-w-[220px]">
            <Select
              value={windowKey}
              onValueChange={(value) => setWindowKey(value as DashboardWindow)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select window" />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <Separator />
        <CardContent
          className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="property-stats"
        >
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border/60 bg-background/70 p-3 shadow-sm sm:p-4"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </div>
              <div
                className={`mt-2 text-xl font-semibold sm:text-2xl ${stat.tone ?? ""}`}
              >
                {stat.value ?? <Skeleton className="h-7 w-24" />}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>New users trend</CardTitle>
          <CardDescription>
            Daily new users for {windowMeta.label} vs. the prior window.
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-6">
          {series.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground sm:h-[260px]">
              {data ? "No trend data available." : "Loading chart data..."}
            </div>
          ) : (
            <ChartContainer
              config={chartConfig}
              className="h-[240px] w-full sm:h-[300px]"
              data-testid="property-trend-chart"
            >
              <LineChart data={series} margin={{ left: 8, right: 20 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                  tickMargin={8}
                />
                <YAxis
                  tickFormatter={(value) => numberFormatter.format(value)}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent indicator="line" />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  type="monotone"
                  dataKey="current"
                  stroke="var(--color-current)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="previous"
                  stroke="var(--color-previous)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
