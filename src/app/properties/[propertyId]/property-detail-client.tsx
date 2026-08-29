"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  CalendarDays,
  CircleAlert,
  Clock3,
  ExternalLink,
  Globe2,
  History,
  RefreshCw,
  Users,
} from "lucide-react";
import type { DashboardWindow, PropertyDetailResponse } from "@/lib/types";
import { classifyTrend, type TrendTone } from "@/lib/trend";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

const DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PropertyTrendChart = dynamic(() => import("./property-trend-chart"), {
  ssr: false,
  loading: () => (
    <Skeleton className="h-[260px] w-full rounded-xl sm:h-[360px]" />
  ),
});

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const updatedFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const trendToneClass: Record<TrendTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-positive",
  negative: "text-negative",
  critical: "text-negative",
};

const formatDomain = (value: string) =>
  value.replace(/^https?:\/\//, "").replace(/\/$/, "");

const formatShortDate = (value: string) => {
  if (!value) return value;
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

const friendlyErrorMessage = (message: string) => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("403") ||
    normalized.includes("permission") ||
    normalized.includes("forbidden")
  ) {
    return "This property is not available to the analytics viewer yet. Check its Google Analytics Viewer access, then retry.";
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("timeout")
  ) {
    return "Google Analytics did not respond. Your last successful result is preserved when available.";
  }

  if (normalized.includes("missing property")) {
    return "This property link is incomplete. Return to the dashboard and choose a property again.";
  }

  return "We could not load this property from Google Analytics. Retry in a moment or return to the dashboard.";
};

type PropertyDetailClientProps = {
  propertyId: string;
};

export default function PropertyDetailClient({
  propertyId,
}: PropertyDetailClientProps) {
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
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const loadProperty = useCallback(
    async (nextWindow: DashboardWindow) => {
      if (!propertyId) {
        setError("Missing property id.");
        setIsLoading(false);
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setError(null);
      setIsLoading(true);

      try {
        const response = await fetch(
          "/api/properties/" + propertyId + "?window=" + nextWindow,
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
          setIsLoading(false);
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
      window.History.prototype.replaceState.call(
        window.history,
        window.history.state,
        "",
        "?" + params.toString(),
      );
    }
  }, [searchParams, windowKey]);

  useEffect(() => {
    void loadProperty(windowKey);
  }, [loadProperty, windowKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadProperty(windowKey);
      }
    }, DATA_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadProperty, windowKey]);

  const windowMeta =
    WINDOW_OPTIONS.find((option) => option.value === windowKey) ??
    WINDOW_OPTIONS[1];
  const currentData = data?.window === windowKey ? data : null;
  const summary = currentData?.summary;
  const series = currentData?.series ?? [];
  const updatedAt = currentData?.updatedAt
    ? updatedFormatter.format(new Date(currentData.updatedAt))
    : null;
  const displayName =
    data?.property.displayName ??
    (isLoading ? "Loading property" : "Property " + propertyId);
  const website = data?.property.defaultUri ?? null;
  const isInitialLoading = isLoading && !currentData;
  const friendlyError = error ? friendlyErrorMessage(error) : null;
  const hasBlockingError = Boolean(error && !currentData);
  const trendTone = summary
    ? classifyTrend(summary, windowKey)
    : "neutral";

  const deltaIcon =
    summary?.delta === undefined || summary.delta === 0 ? (
      <ArrowRight aria-hidden="true" />
    ) : summary.delta > 0 ? (
      <ArrowUp aria-hidden="true" />
    ) : (
      <ArrowDown aria-hidden="true" />
    );
  const deltaDirection =
    summary?.delta === undefined
      ? "Unavailable"
      : summary.delta > 0
        ? "Increase"
        : summary.delta < 0
          ? "Decrease"
          : "No change";

  const statCards = [
    {
      label: "Current " + windowMeta.shortLabel,
      value:
        summary?.current !== undefined
          ? numberFormatter.format(summary.current)
          : null,
      icon: <Users aria-hidden="true" />,
      tone: "text-foreground",
      iconTone: "text-muted-foreground",
      testId: "stat-current",
      accessibleValue:
        summary?.current !== undefined
          ? numberFormatter.format(summary.current) + " new users"
          : isInitialLoading
            ? "Loading"
            : "Unavailable",
    },
    {
      label: "Previous",
      value:
        summary?.previous !== undefined
          ? numberFormatter.format(summary.previous)
          : null,
      icon: <History aria-hidden="true" />,
      tone: "text-muted-foreground",
      iconTone: "text-muted-foreground",
      testId: "stat-previous",
      accessibleValue:
        summary?.previous !== undefined
          ? numberFormatter.format(summary.previous) + " new users"
          : isInitialLoading
            ? "Loading"
            : "Unavailable",
    },
    {
      label: "Net change",
      value:
        summary?.delta !== undefined
          ? (summary.delta > 0 ? "+" : "") +
            numberFormatter.format(summary.delta)
          : null,
      icon: deltaIcon,
      tone: trendToneClass[trendTone],
      iconTone:
        trendTone === "neutral"
          ? "text-muted-foreground"
          : trendToneClass[trendTone],
      testId: "stat-delta",
      accessibleValue:
        summary?.delta !== undefined
          ? deltaDirection +
            " of " +
            numberFormatter.format(Math.abs(summary.delta)) +
            " new users"
          : isInitialLoading
            ? "Loading"
            : "Unavailable",
    },
    {
      label: "Change rate",
      value:
        summary?.pct !== undefined && summary.pct !== null
          ? (summary.pct > 0 ? "+" : "") + percentFormatter.format(summary.pct)
          : summary
            ? "n/a"
            : null,
      icon: <Activity aria-hidden="true" />,
      tone:
        summary?.pct === undefined || summary.pct === null
          ? "text-muted-foreground"
          : trendToneClass[trendTone],
      iconTone:
        summary?.pct === undefined ||
        summary.pct === null ||
        trendTone === "neutral"
          ? "text-muted-foreground"
          : trendToneClass[trendTone],
      testId: "stat-rate",
      accessibleValue:
        summary?.pct !== undefined && summary.pct !== null
          ? deltaDirection + " of " + percentFormatter.format(Math.abs(summary.pct))
          : isInitialLoading
            ? "Loading"
            : "Unavailable",
    },
  ];

  const chartSummary = summary
    ? displayName +
      " recorded " +
      numberFormatter.format(summary.current) +
      " new users in the current " +
      windowMeta.label +
      ", compared with " +
      numberFormatter.format(summary.previous) +
      " in the prior window. " +
      deltaDirection +
      " of " +
      numberFormatter.format(Math.abs(summary.delta)) +
      " users."
    : "Trend data is not available for the selected window.";

  const liveStatus = isLoading
    ? currentData
      ? "Refreshing analytics data."
      : "Loading analytics data."
    : error
      ? currentData
        ? "Refresh failed. Showing the last successful result."
        : "Analytics data could not be loaded."
      : "Analytics data is current.";

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      aria-busy={isLoading}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <header className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-10 rounded-lg border-border bg-secondary/60 px-3 text-sm text-secondary-foreground shadow-sm hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Link
                href="/"
                prefetch={false}
                aria-label="Back to website traffic dashboard"
              >
                <ArrowLeft aria-hidden="true" />
                All properties
              </Link>
            </Button>

            <div
              className={
                "flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-medium shadow-sm " +
                (hasBlockingError
                  ? "border-negative/30 bg-negative-muted text-negative-foreground"
                  : "border-border bg-muted text-muted-foreground")
              }
              data-testid="data-status"
              data-error-severity={
                hasBlockingError ? "blocking" : error ? "stale" : "none"
              }
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {isLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : error ? (
                <CircleAlert className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Activity className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{liveStatus}</span>
            </div>
          </div>

          <div className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>
                  GA4 property / <span className="font-mono">{propertyId}</span>
                </span>
              </div>
              <h1 className="break-words font-display text-4xl font-semibold leading-tight tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
                {displayName}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {website ? (
                  <a
                    className="inline-flex min-h-11 items-center gap-2 text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={website}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={
                      "Open " + displayName + " website in a new tab"
                    }
                  >
                    <Globe2 className="h-4 w-4" aria-hidden="true" />
                    {formatDomain(website)}
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Globe2 className="h-4 w-4" aria-hidden="true" />
                    Website unavailable
                  </span>
                )}
                {updatedAt ? (
                  <span className="inline-flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Updated <time dateTime={currentData?.updatedAt}>{updatedAt}</time>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="w-full rounded-xl border border-border-subtle bg-background/40 p-3 shadow-inner sm:w-72">
              <Label
                htmlFor="property-window-select"
                className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"
              >
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
                Analysis window
              </Label>
              <Select
                value={windowKey}
                onValueChange={(value) =>
                  setWindowKey(value as DashboardWindow)
                }
              >
                <SelectTrigger
                  id="property-window-select"
                  className="h-11 rounded-lg border-input bg-popover text-sm text-popover-foreground shadow-sm focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card"
                >
                  <SelectValue placeholder="Select analysis window" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border bg-popover text-popover-foreground shadow-popover">
                  {WINDOW_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="rounded-md focus:bg-accent focus:text-accent-foreground"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>

        {friendlyError ? (
          <Alert
            className={
              "rounded-xl border py-4 shadow-card " +
              (hasBlockingError
                ? "border-negative/30 bg-negative-muted text-negative-foreground [&>svg]:text-negative"
                : "border-border bg-muted text-muted-foreground [&>svg]:text-muted-foreground")
            }
            data-testid="property-error"
            data-error-severity={hasBlockingError ? "blocking" : "stale"}
          >
            <CircleAlert className="h-5 w-5" aria-hidden="true" />
            <AlertTitle
              className={`text-sm font-semibold ${hasBlockingError ? "text-negative-foreground" : "text-foreground"}`}
            >
              Data connection needs attention
            </AlertTitle>
            <AlertDescription className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-3xl text-sm leading-relaxed">
                {friendlyError}
              </p>
              <Button
                type="button"
                onClick={() => void loadProperty(windowKey)}
                disabled={isLoading}
                className="h-11 shrink-0 rounded-lg border border-primary/40 bg-primary px-4 text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={"Retry loading analytics for " + displayName}
              >
                <RefreshCw
                  className={isLoading ? "animate-spin" : ""}
                  aria-hidden="true"
                />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="property-summary-heading">
          <div className="mb-3 flex items-center justify-between gap-4 px-1">
            <h2
              id="property-summary-heading"
              className="text-sm font-semibold text-foreground"
            >
              Window summary
            </h2>
            <span className="text-xs text-muted-foreground">
              Versus prior {windowMeta.label}
            </span>
          </div>

          <Card className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card">
            <CardContent
              className="grid grid-cols-2 p-0 lg:grid-cols-4"
              data-testid="property-stats"
            >
              {statCards.map((stat, index) => (
                <div
                  key={stat.label}
                  className={
                    "min-h-36 p-4 sm:min-h-40 sm:p-5 " +
                    (index % 2 === 1 ? "border-l border-border-subtle " : "") +
                    (index >= 2 ? "border-t border-border-subtle lg:border-t-0 " : "") +
                    (index > 0 ? "lg:border-l lg:border-border-subtle" : "")
                  }
                >
                  <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
                    <span>{stat.label}</span>
                    <span className={stat.iconTone}>{stat.icon}</span>
                  </div>
                  <div
                    className={
                      "mt-7 font-mono text-3xl font-bold tracking-[-0.05em] sm:text-5xl " +
                      stat.tone
                    }
                    aria-label={stat.accessibleValue}
                    data-testid={stat.testId}
                    data-trend-tone={
                      stat.testId === "stat-delta"
                        ? trendTone
                        : stat.testId === "stat-rate" &&
                            summary?.pct !== undefined &&
                            summary.pct !== null
                          ? trendTone
                        : "neutral"
                    }
                  >
                    {stat.value ??
                      (isInitialLoading ? (
                        <Skeleton className="h-10 w-28 rounded-lg bg-muted sm:h-12" />
                      ) : (
                        "—"
                      ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="trend-heading">
          <Card className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card">
            <div className="flex flex-col gap-3 border-b border-border-subtle p-4 sm:flex-row sm:items-end sm:justify-between sm:p-6">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Daily comparison
                </div>
                <h2
                  id="trend-heading"
                  className="font-display text-2xl font-semibold tracking-[-0.035em] text-card-foreground sm:text-4xl"
                >
                  New users trend
                </h2>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                  Current {windowMeta.label} against the aligned prior window.
                </p>
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
                  aria-label="Trend chart legend"
                  data-testid="trend-legend"
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-0 w-7 border-t-2 border-foreground"
                      aria-hidden="true"
                    />
                    Current
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-0 w-7 border-t-2 border-dashed border-muted-foreground"
                      aria-hidden="true"
                    />
                    Previous
                  </span>
                </div>
              </div>
            </div>

            <CardContent className="p-4 sm:p-6">
              <p id="trend-summary" className="sr-only">
                {chartSummary}
              </p>

              {series.length === 0 ? (
                <div
                  className="flex h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle bg-background/40 px-6 text-center sm:h-[340px]"
                  role="status"
                >
                  {isLoading ? (
                    <RefreshCw
                      className="h-7 w-7 animate-spin text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <BarChart3
                      className="h-7 w-7 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <p className="text-sm text-muted-foreground">
                    {isLoading
                      ? "Loading daily trend"
                      : "No daily trend is available for this window"}
                  </p>
                </div>
              ) : (
                <>
                  <PropertyTrendChart series={series} />

                  <details className="mt-4 border-t border-border-subtle pt-4">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <span>View accessible trend data</span>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </summary>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-border-subtle bg-background/40">
                      <Table
                        aria-describedby="trend-summary"
                        className="min-w-[32rem]"
                      >
                        <TableCaption className="px-3 pb-3 text-left text-xs text-muted-foreground">
                          Daily values for the selected window. Previous values
                          are aligned by day position.
                        </TableCaption>
                        <TableHeader>
                          <TableRow className="border-border-subtle hover:bg-transparent">
                            <TableHead
                              scope="col"
                              className="h-12 px-3 text-xs font-medium text-muted-foreground"
                            >
                              Current date
                            </TableHead>
                            <TableHead
                              scope="col"
                              className="h-12 px-3 text-right text-xs font-medium text-foreground"
                              data-testid="trend-current-heading"
                            >
                              Current
                            </TableHead>
                            <TableHead
                              scope="col"
                              className="h-12 px-3 text-right text-xs font-medium text-muted-foreground"
                              data-testid="trend-previous-heading"
                            >
                              Previous
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {series.map((point) => (
                            <TableRow
                              key={point.date}
                              className="border-border-subtle hover:bg-surface-hover/50"
                            >
                              <TableCell className="px-3 py-3 font-mono text-foreground">
                                <time dateTime={point.date}>
                                  {formatShortDate(point.date)}
                                </time>
                              </TableCell>
                              <TableCell
                                className="px-3 py-3 text-right font-mono font-semibold text-foreground"
                                data-testid="trend-current-value"
                              >
                                {numberFormatter.format(point.current)}
                              </TableCell>
                              <TableCell
                                className="px-3 py-3 text-right font-mono text-muted-foreground"
                                data-testid="trend-previous-value"
                              >
                                {numberFormatter.format(point.previous)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
