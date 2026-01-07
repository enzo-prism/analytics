"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardResponse, DashboardWindow } from "@/lib/types";
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
import { RefreshCcw } from "lucide-react";

const WINDOW_OPTIONS: {
  value: DashboardWindow;
  label: string;
  shortLabel: string;
}[] = [
  { value: "d1", label: "1 day", shortLabel: "1d" },
  { value: "d7", label: "7 days", shortLabel: "7d" },
  { value: "d28", label: "28 days", shortLabel: "28d" },
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
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadDashboard = useCallback(async (nextWindow: DashboardWindow) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
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
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDashboard(windowKey);
  }, [loadDashboard, windowKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadDashboard(windowKey);
    }, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard, windowKey]);

  const filteredProperties = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLowerCase();
    if (!term) return data.properties;
    return data.properties.filter((property) => {
      const nameMatch = property.displayName.toLowerCase().includes(term);
      const domainMatch = property.defaultUri
        ? property.defaultUri.toLowerCase().includes(term)
        : false;
      return nameMatch || domainMatch;
    });
  }, [data, query]);

  const windowMeta =
    WINDOW_OPTIONS.find((option) => option.value === windowKey) ??
    WINDOW_OPTIONS[1];
  const updatedAt = data?.updatedAt
    ? dateFormatter.format(new Date(data.updatedAt))
    : "Not loaded";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16 pt-10 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <Badge variant="secondary">Internal analytics</Badge>
          <div className="space-y-2">
            <h1 className="font-display text-3xl tracking-tight text-foreground sm:text-5xl">
              New Users Pulse
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
              A clean read on GA4 web properties. Compare {windowMeta.label} ending
              yesterday against the previous window.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <span className="text-xs text-muted-foreground">
            Last updated: {updatedAt}
          </span>
          <Button onClick={() => loadDashboard(windowKey)} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Dashboard error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>Filters</CardTitle>
            <CardDescription>
              Switch the reporting window or search by property name or domain.
            </CardDescription>
          </div>
          <Badge variant="outline">
            {data
              ? `${filteredProperties.length} of ${data.properties.length} properties`
              : "Loading properties"}
          </Badge>
        </CardHeader>
        <Separator />
        <CardContent className="grid gap-5 pt-6 md:grid-cols-[1fr_1fr_0.75fr]">
          <div className="space-y-2">
            <Label htmlFor="window-select">Window</Label>
            <Select
              value={windowKey}
              onValueChange={(value) => setWindowKey(value as DashboardWindow)}
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
          <div className="space-y-2">
            <Label>Auto refresh</Label>
            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Every 60 seconds
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>Properties</CardTitle>
            <CardDescription>
              New users for {windowMeta.label} ending yesterday.
            </CardDescription>
          </div>
          <Badge variant="secondary">Compared to previous window</Badge>
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
                {filteredProperties.map((property) => {
                  const current = property.newUsers?.current ?? null;
                  const delta = property.newUsers?.delta ?? null;
                  const pct = property.newUsers?.pct ?? null;
                  const deltaMeta = formatDelta(delta);
                  const pctMeta = formatPct(pct);

                  return (
                    <Card key={property.propertyId} data-testid="property-card">
                      <CardHeader className="space-y-3 pb-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <CardTitle className="text-lg font-display">
                              {property.displayName}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              Property {property.propertyId}
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            {property.error ? (
                              <Badge variant="destructive">Error</Badge>
                            ) : null}
                            <Button size="sm" variant="secondary" asChild>
                              <Link
                                href={`/properties/${property.propertyId}?window=${windowKey}`}
                              >
                                View
                              </Link>
                            </Button>
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
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
                      </CardHeader>
                      <Separator />
                      <CardContent className="space-y-4 pt-4">
                        <div className="grid grid-cols-3 gap-3 text-sm">
                          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              New Users ({windowMeta.shortLabel})
                            </div>
                            <div className="mt-1 text-base font-semibold">
                              {current === null
                                ? "n/a"
                                : numberFormatter.format(current)}
                            </div>
                          </div>
                          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Delta
                            </div>
                            <div className={`mt-1 text-base font-semibold ${deltaMeta.className}`}>
                              {deltaMeta.text}
                            </div>
                          </div>
                          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Percent
                            </div>
                            <div className={`mt-1 text-base font-semibold ${pctMeta.className}`}>
                              {pctMeta.text}
                            </div>
                          </div>
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
