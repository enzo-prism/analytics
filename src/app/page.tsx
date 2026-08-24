"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleMinus,
  RefreshCw,
} from "lucide-react";
import type {
  DashboardProperty,
  DashboardResponse,
  DashboardWindow,
} from "@/lib/types";
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

const WINDOW_OPTIONS: {
  value: DashboardWindow;
  label: string;
  shortLabel: string;
}[] = [
  { value: "d1", label: "Last day", shortLabel: "1d" },
  { value: "d7", label: "Last 7 days", shortLabel: "7d" },
  { value: "d28", label: "Last 28 days", shortLabel: "28d" },
  { value: "d90", label: "Last 90 days", shortLabel: "90d" },
  { value: "d180", label: "Last 180 days", shortLabel: "180d" },
  { value: "d365", label: "Last year", shortLabel: "1y" },
];

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
type StatusFilter = "all" | "growing" | "declining" | "flat" | "issue";

const formatSignedNumber = (value: number | null) => {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${numberFormatter.format(value)}`;
};

const formatSignedPercent = (value: number | null) => {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${percentFormatter.format(value)}`;
};

const getStatus = (property: DashboardProperty): Exclude<StatusFilter, "all"> => {
  if (property.error || !property.newUsers) return "issue";
  if (property.newUsers.delta > 0) return "growing";
  if (property.newUsers.delta < 0) return "declining";
  return "flat";
};

const statusMeta = {
  growing: {
    label: "Growing",
    icon: ArrowUpRight,
    valueClass: "text-positive",
  },
  declining: {
    label: "Declining",
    icon: ArrowDownRight,
    valueClass: "text-negative",
  },
  flat: {
    label: "Flat",
    icon: CircleMinus,
    valueClass: "text-muted-foreground",
  },
  issue: {
    label: "Issue",
    icon: AlertTriangle,
    valueClass: "text-muted-foreground",
  },
};

export default function Home() {
  const [windowKey, setWindowKey] = useState<DashboardWindow>("d7");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  const loadDashboard = useCallback(async (nextWindow: DashboardWindow) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`/api/dashboard?window=${nextWindow}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload) {
        throw new Error("Dashboard data is temporarily unavailable.");
      }

      if (requestId === requestIdRef.current) {
        setData(payload as DashboardResponse);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError("We could not refresh Google Analytics. Existing values remain visible.");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard(windowKey);
  }, [loadDashboard, windowKey]);

  useEffect(() => {
    const interval = setInterval(() => loadDashboard(windowKey), 60_000);
    return () => clearInterval(interval);
  }, [loadDashboard, windowKey]);

  const attention = useMemo(
    () =>
      [...(data?.properties ?? [])]
        .filter((property) => property.newUsers && property.newUsers.delta < 0)
        .sort(
          (a, b) =>
            (a.newUsers?.delta ?? Number.POSITIVE_INFINITY) -
            (b.newUsers?.delta ?? Number.POSITIVE_INFINITY),
        )[0],
    [data],
  );

  const visibleProperties = useMemo(
    () =>
      (data?.properties ?? []).filter(
        (property) =>
          statusFilter === "all" || getStatus(property) === statusFilter,
      ),
    [data, statusFilter],
  );

  const dataWindow = data?.window ?? windowKey;
  const dataWindowMeta =
    WINDOW_OPTIONS.find((option) => option.value === dataWindow) ??
    WINDOW_OPTIONS[1];
  const isInitialLoad = isLoading && !data;

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-5 sm:px-6 sm:pb-16 sm:pt-6 lg:gap-6 lg:px-10 lg:pt-8"
      aria-busy={isLoading}
    >
      <div className="grid w-full grid-cols-[44px_minmax(0,1fr)] gap-2 sm:flex sm:items-center sm:justify-end sm:gap-3">
        <h1 className="sr-only">Analytics dashboard</h1>
        <p className="sr-only" role="status" aria-live="polite">
          {isLoading ? "Refreshing analytics data" : "Analytics data ready"}
        </p>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl border-border bg-secondary/40 hover:bg-secondary hover:text-foreground sm:h-10 sm:w-10 sm:rounded-lg"
          onClick={() => loadDashboard(windowKey)}
          disabled={isLoading}
          aria-label={isLoading ? "Refreshing analytics data" : "Refresh analytics data"}
        >
          <RefreshCw className={isLoading ? "animate-spin" : ""} />
        </Button>
        <div className="min-w-0 sm:min-w-[220px]">
          <Label htmlFor="window-select" className="sr-only">Reporting window</Label>
          <Select
            value={windowKey}
            onValueChange={(value) => setWindowKey(value as DashboardWindow)}
          >
            <SelectTrigger
              id="window-select"
              className="h-11 w-full rounded-xl border-border bg-secondary/40 text-sm font-medium hover:border-input sm:h-10 sm:rounded-lg"
            >
              <CalendarDays aria-hidden="true" className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select window" />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="min-h-11 py-2.5 sm:min-h-8 sm:py-1.5"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <Alert className="rounded-xl border-border bg-card text-foreground shadow-sm" role="status">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" className="h-11 w-full rounded-xl border-border sm:h-8 sm:w-auto sm:rounded-lg" onClick={() => loadDashboard(windowKey)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {attention ? (
        <section aria-labelledby="priority-signal-heading">
          <Link
            href={`/properties/${attention.propertyId}?window=${dataWindow}`}
            aria-label={`Review ${attention.displayName} priority signal`}
            className="group grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-negative/20 bg-negative-muted/35 px-4 py-3 transition-colors hover:border-negative/35 hover:bg-negative-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-20 sm:rounded-2xl sm:px-6 sm:py-4"
          >
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-negative sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <h2 id="priority-signal-heading" className="text-xs font-semibold text-negative sm:text-sm">
                Priority signal
              </h2>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm leading-snug sm:text-base">
                <span className="font-semibold">{attention.displayName}</span>
                <span className="text-muted-foreground">Largest decline</span>
                <span className="font-mono font-semibold text-negative">
                  {formatSignedNumber(attention.newUsers?.delta ?? null)} / {formatSignedPercent(attention.newUsers?.pct ?? null)}
                </span>
              </p>
            </div>
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-negative/75 transition-transform group-hover:translate-x-0.5 group-hover:text-negative"
            />
          </Link>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 sm:gap-4" aria-labelledby="properties-heading">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(138px,160px)] items-end gap-3 rounded-none border-0 bg-transparent p-0 shadow-none sm:flex sm:flex-col sm:items-stretch sm:gap-4 sm:rounded-2xl sm:border sm:border-border/80 sm:bg-card sm:p-5 sm:shadow-card xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="hidden text-xs font-medium text-muted-foreground sm:block">Live property index</div>
            <h2 id="properties-heading" className="text-2xl font-semibold tracking-[-0.03em] sm:mt-1">
              Properties
            </h2>
            <p className="mt-1 text-xs text-muted-foreground sm:hidden">
              {visibleProperties.length} {visibleProperties.length === 1 ? "property" : "properties"} · {dataWindowMeta.label}
            </p>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{dataWindowMeta.label} compared with the previous period.</p>
          </div>
          <div className="min-w-0 sm:w-48">
            <div>
              <Label htmlFor="status-select" className="sr-only">Filter by status</Label>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as StatusFilter)
                }
              >
                <SelectTrigger id="status-select" className="h-11 w-full rounded-xl border-border bg-secondary/35 text-sm hover:border-input sm:h-10 sm:rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="min-h-11 py-2.5 sm:min-h-8 sm:py-1.5">All statuses</SelectItem>
                  <SelectItem value="growing" className="min-h-11 py-2.5 sm:min-h-8 sm:py-1.5">Growing</SelectItem>
                  <SelectItem value="declining" className="min-h-11 py-2.5 sm:min-h-8 sm:py-1.5">Declining</SelectItem>
                  <SelectItem value="flat" className="min-h-11 py-2.5 sm:min-h-8 sm:py-1.5">Flat</SelectItem>
                  <SelectItem value="issue" className="min-h-11 py-2.5 sm:min-h-8 sm:py-1.5">Data issues</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="hidden items-center justify-between px-1 text-xs text-muted-foreground sm:flex">
          <span>
            {visibleProperties.length}{" "}
            {visibleProperties.length === 1 ? "property" : "properties"}
          </span>
          <span>{isLoading ? "Updating" : `Window ${dataWindowMeta.shortLabel}`}</span>
        </div>

        <div data-testid="property-cards">
          {isInitialLoad ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Card
                  key={index}
                  className="min-h-[148px] min-w-0 rounded-2xl border-border/60 bg-card p-4 shadow-none sm:min-h-52 sm:border-border/70 sm:p-5 sm:shadow-card"
                >
                  <Skeleton className="h-full min-h-[116px] w-full rounded-xl sm:min-h-44" />
                </Card>
              ))}
            </div>
          ) : visibleProperties.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-4 rounded-2xl border border-border/70 bg-card p-6 text-center shadow-none sm:min-h-52 sm:p-8 sm:shadow-card">
              <CircleMinus aria-hidden="true" className="h-7 w-7" />
              <div>
                <h3 className="font-semibold">No properties in this status</h3>
                <p className="mt-1 text-sm text-muted-foreground">Show all properties to return to the full portfolio.</p>
              </div>
              <Button
                variant="outline"
                className="min-h-11 rounded-xl border-border sm:rounded-lg"
                onClick={() => setStatusFilter("all")}
              >
                Show all properties
              </Button>
            </div>
          ) : (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
              {visibleProperties.map((property) => {
                const status = getStatus(property);
                const StatusIcon = statusMeta[status].icon;
                return (
                  <Link
                    key={property.propertyId}
                    href={`/properties/${property.propertyId}?window=${dataWindow}`}
                    aria-label={`Open ${property.displayName} analytics`}
                    className="group block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <Card
                      data-testid="property-card"
                      className="flex h-full min-h-[148px] min-w-0 flex-col rounded-2xl border-border/60 bg-card shadow-none transition-colors duration-150 group-hover:border-input/60 group-hover:bg-surface-hover/40 group-active:bg-surface-hover/60 sm:min-h-52 sm:border-border/70 sm:shadow-card"
                    >
                      <CardContent className="flex h-full flex-col p-4 sm:p-6">
                        <div className="flex items-start justify-between gap-4">
                          <h3 className="line-clamp-2 min-h-10 min-w-0 text-base font-semibold leading-tight tracking-[-0.02em] text-foreground sm:min-h-0 sm:truncate sm:text-xl sm:leading-normal">
                            {property.displayName}
                          </h3>
                          <ArrowRight
                            aria-hidden="true"
                            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
                          />
                        </div>

                        <div className="mt-5 flex flex-1 items-end justify-between gap-3 sm:mt-9 sm:flex-col sm:items-start">
                          <div className="shrink-0">
                            <div className="text-xs text-muted-foreground sm:text-sm">
                              New users · {dataWindowMeta.shortLabel}
                            </div>
                            <div className="mt-1 font-mono text-[2rem] font-semibold leading-none tracking-[-0.05em] text-foreground tabular-nums sm:text-4xl sm:leading-normal">
                              {property.newUsers
                                ? numberFormatter.format(property.newUsers.current)
                                : "n/a"}
                            </div>
                          </div>

                          {property.newUsers ? (
                            <div
                              className={`inline-flex max-w-[58%] flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-right text-xs leading-snug sm:mt-auto sm:max-w-none sm:justify-start sm:pt-7 sm:text-left sm:text-sm ${statusMeta[status].valueClass}`}
                            >
                              <StatusIcon aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              <span className="sr-only">{statusMeta[status].label}:</span>
                              <span className="font-mono font-semibold tabular-nums">
                                {formatSignedNumber(property.newUsers.delta)}
                              </span>
                              <span aria-hidden="true" className="text-muted-foreground">·</span>
                              <span className="font-mono tabular-nums">
                                {formatSignedPercent(property.newUsers.pct)}
                              </span>
                              <span className="text-muted-foreground">vs prior</span>
                            </div>
                          ) : (
                            <div className="inline-flex max-w-[58%] items-center justify-end gap-2 text-right text-xs text-muted-foreground sm:mt-auto sm:max-w-none sm:justify-start sm:pt-7 sm:text-left sm:text-sm">
                              <StatusIcon aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              <span>Data unavailable</span>
                            </div>
                          )}
                        </div>

                        {property.error ? (
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:mt-3">
                            {property.error}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
