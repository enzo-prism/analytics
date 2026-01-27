"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardResponse,
  DashboardWindow,
  TotalResponse,
  TotalWindow,
} from "@/lib/types";
import Link from "next/link";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, Triangle } from "lucide-react";

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

const TOTAL_WINDOW_OPTIONS: {
  value: TotalWindow;
  label: string;
  shortLabel: string;
}[] = [
  { value: "d7", label: "7 days", shortLabel: "7d" },
  { value: "d30", label: "30 days", shortLabel: "30d" },
  { value: "d60", label: "60 days", shortLabel: "60d" },
  { value: "d90", label: "90 days", shortLabel: "90d" },
  { value: "d365", label: "1 year", shortLabel: "1y" },
];

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatDomain = (value: string) =>
  value.replace(/^https?:\/\//, "").replace(/\/$/, "");

const formatDelta = (delta: number | null) => {
  if (delta === null) {
    return { text: "n/a", className: "text-muted-foreground" };
  }
  return {
    text: `${delta > 0 ? "+" : ""}${numberFormatter.format(delta)}`,
    className: delta >= 0 ? "text-emerald-600" : "text-rose-600",
  };
};

const formatPct = (pct: number | null) => {
  if (pct === null) {
    return { text: "n/a", className: "text-muted-foreground" };
  }
  return {
    text: `${pct > 0 ? "+" : ""}${percentFormatter.format(pct)}`,
    className: pct >= 0 ? "text-emerald-600" : "text-rose-600",
  };
};

export default function Home() {
  const [windowKey, setWindowKey] = useState<DashboardWindow>("d7");
  const [totalWindow, setTotalWindow] = useState<TotalWindow>("d7");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [totalData, setTotalData] = useState<TotalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalError, setTotalError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showUpdatedAt, setShowUpdatedAt] = useState(false);
  const requestIdRef = useRef(0);
  const totalRequestIdRef = useRef(0);

  const loadDashboard = useCallback(async (nextWindow: DashboardWindow) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError(null);

    try {
      const response = await fetch(`/api/dashboard?window=${nextWindow}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Failed to load dashboard data.";
        throw new Error(message);
      }

      if (!payload) {
        throw new Error("Empty response from the dashboard API.");
      }

      if (requestId === requestIdRef.current) {
        setData(payload as DashboardResponse);
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
            : "Failed to load dashboard data.",
        );
      }
    }
  }, []);

  const loadTotal = useCallback(async (nextWindow: TotalWindow) => {
    const requestId = totalRequestIdRef.current + 1;
    totalRequestIdRef.current = requestId;
    setTotalError(null);

    try {
      const response = await fetch(`/api/total?window=${nextWindow}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Failed to load total new users.";
        throw new Error(message);
      }

      if (!payload) {
        throw new Error("Empty response from the total API.");
      }

      if (requestId === totalRequestIdRef.current) {
        setTotalData(payload as TotalResponse);
      }
    } catch (fetchError) {
      if (
        fetchError instanceof DOMException &&
        fetchError.name === "AbortError"
      ) {
        return;
      }
      if (requestId === totalRequestIdRef.current) {
        setTotalError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load total new users.",
        );
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard(windowKey);
  }, [loadDashboard, windowKey]);

  useEffect(() => {
    loadTotal(totalWindow);
  }, [loadTotal, totalWindow]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadDashboard(windowKey);
    }, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard, windowKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadTotal(totalWindow);
    }, 60000);
    return () => clearInterval(interval);
  }, [loadTotal, totalWindow]);

  const filteredProperties = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLowerCase();
    const base = term
      ? data.properties.filter((property) => {
          const nameMatch = property.displayName.toLowerCase().includes(term);
          const domainMatch = property.defaultUri
            ? property.defaultUri.toLowerCase().includes(term)
            : false;
          return nameMatch || domainMatch;
        })
      : data.properties;

    return [...base].sort((a, b) => {
      const aValue = a.newUsers?.current ?? -1;
      const bValue = b.newUsers?.current ?? -1;
      return bValue - aValue;
    });
  }, [data, query]);

  const windowMeta =
    WINDOW_OPTIONS.find((option) => option.value === windowKey) ??
    WINDOW_OPTIONS[1];
  const totalWindowMeta =
    TOTAL_WINDOW_OPTIONS.find((option) => option.value === totalWindow) ??
    TOTAL_WINDOW_OPTIONS[0];
  const updatedAt = data?.updatedAt
    ? dateFormatter.format(new Date(data.updatedAt))
    : null;
  const totalValue = totalData?.total ?? null;
  const totalPropertyCount = totalData?.propertyCount ?? 0;
  const totalErrorCount = totalData?.errorCount ?? 0;
  const totalStatus =
    totalError ??
    (!totalData
      ? "Loading total new users."
      : totalErrorCount > 0
        ? `Partial data: ${totalErrorCount} properties failed to load.`
        : totalPropertyCount === 0
          ? "No properties available."
          : `Across ${totalPropertyCount} properties.`);

  useEffect(() => {
    if (!updatedAt) {
      setShowUpdatedAt(false);
      return;
    }
    setShowUpdatedAt(true);
    const timeout = setTimeout(() => {
      setShowUpdatedAt(false);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [updatedAt]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-display text-3xl tracking-tight text-foreground sm:text-5xl">
            Website Traffic
          </h1>
        </div>
        {showUpdatedAt && updatedAt ? (
          <span className="text-xs text-muted-foreground">
            Last updated: {updatedAt}
          </span>
        ) : null}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Dashboard error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card data-testid="total-new-users-card">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>Total new users</CardTitle>
            <CardDescription>
              Last {totalWindowMeta.label} ending yesterday.
            </CardDescription>
          </div>
          <div className="space-y-2 sm:text-right">
            <Label htmlFor="total-window-select">Window</Label>
            <Select
              value={totalWindow}
              onValueChange={(value) => setTotalWindow(value as TotalWindow)}
            >
              <SelectTrigger id="total-window-select">
                <SelectValue placeholder="Select window" />
              </SelectTrigger>
              <SelectContent>
                {TOTAL_WINDOW_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Total New Users ({totalWindowMeta.shortLabel})
            </div>
            <div
              className="text-4xl font-semibold text-foreground"
              data-testid="total-new-users"
            >
              {totalValue === null
                ? totalError
                  ? "n/a"
                  : "Loading..."
                : numberFormatter.format(totalValue)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{totalStatus}</div>
        </CardContent>
      </Card>

      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>Filters</CardTitle>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                {filtersOpen ? "Hide" : "Show"}
                <ChevronDown
                  className={`ml-2 h-4 w-4 transition-transform ${
                    filtersOpen ? "rotate-180" : ""
                  }`}
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <Separator />
            <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="window-select">Window</Label>
                <Select
                  value={windowKey}
                  onValueChange={(value) =>
                    setWindowKey(value as DashboardWindow)
                  }
                >
                  <SelectTrigger id="window-select">
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
              <div className="space-y-2">
                <Label htmlFor="search-input">Search</Label>
                <Input
                  id="search-input"
                  placeholder="Filter by site name or domain"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>Properties</CardTitle>
            <CardDescription>
              New users for {windowMeta.label} ending yesterday.
            </CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          <div data-testid="property-cards">
            {filteredProperties.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {data
                  ? "No properties match the current filter."
                  : "Loading dashboard data."}
              </div>
            ) : (
              <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredProperties.map((property, index) => {
                  const current = property.newUsers?.current ?? null;
                  const delta = property.newUsers?.delta ?? null;
                  const pct = property.newUsers?.pct ?? null;
                  const deltaMeta = formatDelta(delta);
                  const pctMeta = formatPct(pct);

                  return (
                    <Card key={property.propertyId} data-testid="property-card">
                      <CardContent className="space-y-4 p-4 sm:p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-white text-2xl shadow-sm">
                              {property.emoji}
                            </div>
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-display text-lg font-semibold leading-tight sm:text-xl">
                                  {property.displayName}
                                </h3>
                                {property.error ? (
                                  <Badge variant="destructive">Error</Badge>
                                ) : null}
                              </div>
                              <CardDescription className="text-[11px]">
                                Property {property.propertyId}
                              </CardDescription>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">
                              {index + 1}
                            </div>
                            <Button size="sm" variant="secondary" asChild>
                              <Link
                                href={`/properties/${property.propertyId}?window=${windowKey}`}
                              >
                                View
                              </Link>
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-border/70 bg-white px-4 py-3">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            New Users ({windowMeta.shortLabel})
                          </div>
                          <div className="mt-1 text-3xl font-semibold text-foreground sm:text-4xl">
                            {current === null
                              ? "n/a"
                              : numberFormatter.format(current)}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Triangle className="h-3 w-3" />
                              Delta
                            </span>
                            <span className={`font-semibold ${deltaMeta.className}`}>
                              {deltaMeta.text}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Percent</span>
                            <span className={`font-semibold ${pctMeta.className}`}>
                              {pctMeta.text}
                            </span>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          {property.defaultUri ? (
                            <a
                              className="underline-offset-4 hover:text-foreground hover:underline"
                              href={property.defaultUri}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {formatDomain(property.defaultUri)}
                            </a>
                          ) : (
                            "Domain unavailable"
                          )}
                        </div>

                        {property.error ? (
                          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {property.error}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
