"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  ExternalLink,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import type {
  DashboardProperty,
  DashboardResponse,
  DashboardWindow,
} from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type StatusFilter = "all" | "growing" | "declining" | "flat" | "issue";
type SortKey = "rank" | "name" | "growth" | "decline";
const PAGE_SIZE = 10;

const formatDomain = (value: string) =>
  value.replace(/^https?:\/\//, "").replace(/\/$/, "");

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
    badgeClass: "border-positive/25 bg-positive/10 text-positive",
  },
  declining: {
    label: "Declining",
    icon: ArrowDownRight,
    valueClass: "text-negative",
    badgeClass: "border-negative/25 bg-negative/10 text-negative",
  },
  flat: {
    label: "Flat",
    icon: CircleMinus,
    valueClass: "text-muted-foreground",
    badgeClass: "border-border bg-secondary/70 text-muted-foreground",
  },
  issue: {
    label: "Issue",
    icon: AlertTriangle,
    valueClass: "text-muted-foreground",
    badgeClass: "border-border bg-secondary/70 text-muted-foreground",
  },
};

export default function Home() {
  const [windowKey, setWindowKey] = useState<DashboardWindow>("d7");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [page, setPage] = useState(0);
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

  const summary = useMemo(() => {
    const properties = data?.properties ?? [];
    const reporting = properties.filter((property) => property.newUsers);
    const total = reporting.reduce(
      (sum, property) => sum + (property.newUsers?.current ?? 0),
      0,
    );
    const previous = reporting.reduce(
      (sum, property) => sum + (property.newUsers?.previous ?? 0),
      0,
    );
    const delta = total - previous;
    const pct = previous === 0 ? null : delta / previous;
    const growing = properties.filter(
      (property) => getStatus(property) === "growing",
    ).length;
    const declining = properties.filter(
      (property) => getStatus(property) === "declining",
    ).length;
    const issues = properties.filter(
      (property) => getStatus(property) === "issue",
    ).length;
    const attention = [...properties]
      .filter((property) => property.newUsers && property.newUsers.delta < 0)
      .sort(
        (a, b) =>
          (a.newUsers?.delta ?? Number.POSITIVE_INFINITY) -
          (b.newUsers?.delta ?? Number.POSITIVE_INFINITY),
      )[0];

    return { total, previous, delta, pct, growing, declining, issues, attention };
  }, [data]);

  const filteredProperties = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = (data?.properties ?? []).filter((property) => {
      const matchesQuery =
        !term ||
        property.displayName.toLowerCase().includes(term) ||
        property.defaultUri?.toLowerCase().includes(term) ||
        property.propertyId.includes(term);
      const matchesStatus =
        statusFilter === "all" || getStatus(property) === statusFilter;
      return matchesQuery && matchesStatus;
    });

    return filtered.sort((a, b) => {
      if (sortKey === "name") return a.displayName.localeCompare(b.displayName);
      if (sortKey === "growth") {
        return (b.newUsers?.pct ?? -Infinity) - (a.newUsers?.pct ?? -Infinity);
      }
      if (sortKey === "decline") {
        return (a.newUsers?.pct ?? Infinity) - (b.newUsers?.pct ?? Infinity);
      }
      return (b.newUsers?.current ?? -1) - (a.newUsers?.current ?? -1);
    });
  }, [data, query, sortKey, statusFilter]);

  const dataWindow = data?.window ?? windowKey;
  const dataWindowMeta =
    WINDOW_OPTIONS.find((option) => option.value === dataWindow) ??
    WINDOW_OPTIONS[1];
  const updatedAt = data?.updatedAt
    ? dateFormatter.format(new Date(data.updatedAt))
    : null;
  const isInitialLoad = isLoading && !data;
  const pageCount = Math.max(1, Math.ceil(filteredProperties.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleProperties = filteredProperties.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const pageStart = filteredProperties.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const pageEnd = Math.min((safePage + 1) * PAGE_SIZE, filteredProperties.length);

  const metricCards = [
    {
      label: "Total new users",
      value: numberFormatter.format(summary.total),
      detail: `${formatSignedNumber(summary.delta)} / ${formatSignedPercent(summary.pct)} vs prior`,
      icon: Users,
      valueClass: "text-foreground",
      iconClass: "text-foreground",
      detailClass:
        summary.delta > 0
          ? "text-positive"
          : summary.delta < 0
            ? "text-negative"
            : "text-muted-foreground",
    },
    {
      label: "Growing properties",
      value: numberFormatter.format(summary.growing),
      detail: `${data?.properties.length ? percentFormatter.format(summary.growing / data.properties.length) : "0%"} of portfolio`,
      icon: ArrowUpRight,
      valueClass: "text-foreground",
      iconClass: "text-positive",
      detailClass: "text-positive",
    },
    {
      label: "Declining properties",
      value: numberFormatter.format(summary.declining),
      detail: `${data?.properties.length ? percentFormatter.format(summary.declining / data.properties.length) : "0%"} of portfolio`,
      icon: ArrowDownRight,
      valueClass: "text-foreground",
      iconClass: "text-negative",
      detailClass: "text-negative",
    },
    {
      label: "Data issues",
      value: numberFormatter.format(summary.issues),
      detail: summary.issues === 0 ? "All sources reporting" : "Review failed properties",
      icon: AlertTriangle,
      valueClass: "text-foreground",
      iconClass: "text-muted-foreground",
      detailClass: "text-muted-foreground",
    },
  ];

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-5 px-4 pb-16 pt-4 sm:px-6 sm:pt-6 lg:gap-6 lg:px-10 lg:pt-8"
      aria-busy={isLoading}
    >
      <header className="flex flex-col gap-6 rounded-2xl border border-border/80 bg-card px-5 py-6 shadow-card sm:px-7 lg:flex-row lg:items-center lg:justify-between lg:py-7">
        <div className="flex items-start gap-4">
          <div className="mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-secondary/70 text-foreground shadow-sm">
            <BarChart3 aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Google Analytics portfolio
            </div>
            <h1 className="font-display text-4xl font-semibold leading-none tracking-[-0.05em] sm:text-6xl">
              New Users
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3 sm:flex sm:items-center">
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 text-xs font-medium text-muted-foreground">
            {isLoading ? (
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
                <Check aria-hidden="true" className="h-3.5 w-3.5 text-positive" />
            )}
            <span aria-live="polite">
              {isLoading ? "Syncing live data" : updatedAt ? `Updated ${updatedAt}` : "Ready"}
            </span>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-lg border-border bg-secondary/40 hover:bg-secondary hover:text-foreground"
            onClick={() => loadDashboard(windowKey)}
            disabled={isLoading}
            aria-label="Refresh analytics data"
          >
            <RefreshCw className={isLoading ? "animate-spin" : ""} />
          </Button>
          <div className="col-span-2 min-w-[220px] sm:col-auto">
            <Label htmlFor="window-select" className="sr-only">Reporting window</Label>
            <Select
              value={windowKey}
              onValueChange={(value) => setWindowKey(value as DashboardWindow)}
            >
              <SelectTrigger
                id="window-select"
                className="h-10 rounded-lg border-border bg-secondary/40 text-sm font-medium hover:border-input"
              >
                <CalendarDays aria-hidden="true" className="mr-2 h-4 w-4" />
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
        </div>
      </header>

      {error ? (
        <Alert className="rounded-xl border-border bg-card text-foreground shadow-sm" role="status">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" className="rounded-lg border-border" onClick={() => loadDashboard(windowKey)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-labelledby="portfolio-summary">
        <h2 id="portfolio-summary" className="sr-only">Portfolio summary</h2>
        {metricCards.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              data-testid={index === 0 ? "total-new-users-card" : undefined}
              className="min-h-40 rounded-2xl border border-border/80 bg-card p-4 shadow-card sm:min-h-44 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  {metric.label}
                </span>
                <div className={`grid h-9 w-9 place-items-center rounded-lg ${metric.iconClass}`}>
                  <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
                </div>
              </div>
              {isInitialLoad ? (
                <Skeleton className="mt-7 h-12 w-32 rounded-lg" />
              ) : (
                <div
                  className={`mt-6 font-mono text-4xl font-bold tracking-[-0.06em] sm:text-5xl ${metric.valueClass}`}
                  data-testid={index === 0 ? "total-new-users" : undefined}
                >
                  {metric.value}
                </div>
              )}
              <p className={`mt-3 text-xs ${metric.detailClass}`}>{metric.detail}</p>
            </div>
          );
        })}
      </section>

      {summary.attention ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-negative/25 bg-negative-muted/70 px-5 py-4 shadow-card sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-negative" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-negative">Priority signal</h2>
              <p className="mt-1 text-sm font-semibold sm:text-base">
                {summary.attention.displayName} has the largest decline:{" "}
                <span className="font-mono text-negative">
                  {formatSignedNumber(summary.attention.newUsers?.delta ?? null)} / {formatSignedPercent(summary.attention.newUsers?.pct ?? null)}
                </span>
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            className="h-10 shrink-0 rounded-lg border border-negative/30 bg-transparent text-negative hover:bg-negative/10 hover:text-negative"
            asChild
          >
            <Link href={`/properties/${summary.attention.propertyId}?window=${dataWindow}`} aria-label={`Open ${summary.attention.displayName} analytics`}>
              Inspect property
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </section>
      ) : null}

      <section className="flex flex-col gap-4" aria-labelledby="properties-heading">
        <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-card sm:p-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Live property index</div>
            <h2 id="properties-heading" className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Properties</h2>
            <p className="mt-1 text-sm text-muted-foreground">{dataWindowMeta.label} compared with the previous period.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px_180px]">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Label htmlFor="search-input" className="sr-only">Search properties</Label>
              <Input
                id="search-input"
                className="h-10 rounded-lg border-border bg-secondary/35 pl-9 pr-9 text-sm focus-visible:border-input"
                placeholder="Search property or domain"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setQuery("");
                    setPage(0);
                  }}
                  aria-label="Clear search"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div>
              <Label htmlFor="status-select" className="sr-only">Filter by status</Label>
              <Select value={statusFilter} onValueChange={(value) => {
                setStatusFilter(value as StatusFilter);
                setPage(0);
              }}>
                <SelectTrigger id="status-select" className="h-10 rounded-lg border-border bg-secondary/35 text-sm hover:border-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="growing">Growing</SelectItem>
                  <SelectItem value="declining">Declining</SelectItem>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="issue">Data issues</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sort-select" className="sr-only">Sort properties</Label>
              <Select value={sortKey} onValueChange={(value) => {
                setSortKey(value as SortKey);
                setPage(0);
              }}>
                <SelectTrigger id="sort-select" className="h-10 rounded-lg border-border bg-secondary/35 text-sm hover:border-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rank">Sort: New users</SelectItem>
                  <SelectItem value="name">Sort: Name</SelectItem>
                  <SelectItem value="growth">Sort: Growth</SelectItem>
                  <SelectItem value="decline">Sort: Decline</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>{pageStart}-{pageEnd} / {filteredProperties.length} properties</span>
          <span>{isLoading ? "Updating" : `Window ${dataWindowMeta.shortLabel}`}</span>
        </div>

        <div data-testid="property-cards">
          {isInitialLoad ? (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Card
                  key={index}
                  className="min-h-72 min-w-0 rounded-2xl border-border/70 bg-card p-5 shadow-card"
                >
                  <Skeleton className="h-full min-h-60 w-full rounded-xl" />
                </Card>
              ))}
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-4 rounded-2xl border border-border/70 bg-card p-8 text-center shadow-card">
              <Search aria-hidden="true" className="h-7 w-7" />
              <div>
                <h3 className="font-semibold">No properties found</h3>
                <p className="mt-1 text-sm text-muted-foreground">Clear the current filters and try again.</p>
              </div>
              <Button variant="outline" className="rounded-lg border-border" onClick={() => { setQuery(""); setStatusFilter("all"); setPage(0); }}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProperties.map((property, index) => {
                const status = getStatus(property);
                const StatusIcon = statusMeta[status].icon;
                return (
                  <Card
                    key={property.propertyId}
                    data-testid="property-card"
                    className="group flex h-full min-w-0 flex-col rounded-2xl border-border/70 bg-card shadow-card transition-[transform,border-color,background-color,box-shadow] duration-150 hover:-translate-y-px hover:border-input/60 hover:bg-surface-hover/55 hover:shadow-card-hover active:scale-[0.995]"
                  >
                    <CardContent className="flex h-full flex-col p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">
                            #{String(safePage * PAGE_SIZE + index + 1).padStart(2, "0")} · ID {property.propertyId}
                          </div>
                          <h3 className="mt-2 truncate text-xl font-semibold tracking-[-0.02em]">
                            <Link
                              href={`/properties/${property.propertyId}?window=${dataWindow}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {property.displayName}
                            </Link>
                          </h3>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusMeta[status].badgeClass}`}
                        >
                          <StatusIcon aria-hidden="true" className="mr-1.5 h-3 w-3" />
                          {statusMeta[status].label}
                        </Badge>
                      </div>

                      <div className="mt-8 flex items-end justify-between gap-4 border-b border-border/70 pb-5">
                        <div>
                          <div className="text-sm text-muted-foreground">
                            New Users ({dataWindowMeta.shortLabel})
                          </div>
                          <div className="mt-1 font-mono text-4xl font-semibold tracking-[-0.05em] text-foreground tabular-nums">
                            {property.newUsers
                              ? numberFormatter.format(property.newUsers.current)
                              : "n/a"}
                          </div>
                        </div>
                        <div className={`pb-1 text-right ${statusMeta[status].valueClass}`}>
                          <div className="inline-flex items-center gap-1 text-sm font-semibold">
                            <StatusIcon aria-hidden="true" className="h-4 w-4" />
                            <span>{statusMeta[status].label}</span>
                          </div>
                          <div className="mt-1 font-mono text-xs tabular-nums">
                            {formatSignedNumber(property.newUsers?.delta ?? null)} · {formatSignedPercent(property.newUsers?.pct ?? null)}
                          </div>
                        </div>
                      </div>

                      {property.error ? (
                        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                          {property.error}
                        </p>
                      ) : null}

                      <div className="mt-auto flex items-center justify-between gap-4 pt-5">
                        {property.defaultUri ? (
                          <a
                            href={property.defaultUri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            aria-label={`Open ${property.displayName} website in a new tab`}
                          >
                            <span className="truncate">{formatDomain(property.defaultUri)}</span>
                            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">Domain unavailable</span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 shrink-0 rounded-lg px-3 hover:bg-secondary hover:text-foreground"
                          asChild
                        >
                          <Link
                            href={`/properties/${property.propertyId}?window=${dataWindow}`}
                            aria-label={`Open ${property.displayName} analytics`}
                          >
                            View
                            <ArrowRight aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {!isInitialLoad && filteredProperties.length > PAGE_SIZE ? (
          <nav
            className="flex items-center justify-between px-1 pt-1"
            aria-label="Property pages"
          >
            <span className="text-xs text-muted-foreground">
              Page {safePage + 1} / {pageCount}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 rounded-lg border-border"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={safePage === 0}
                aria-label="Previous property page"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11 rounded-lg border-border"
                onClick={() =>
                  setPage((current) => Math.min(pageCount - 1, current + 1))
                }
                disabled={safePage >= pageCount - 1}
                aria-label="Next property page"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        ) : null}
      </section>
    </main>
  );
}
