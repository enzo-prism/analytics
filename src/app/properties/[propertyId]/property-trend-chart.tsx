"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { PropertySeriesPoint } from "@/lib/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const chartConfig = {
  current: {
    label: "Current window",
    color: "hsl(var(--foreground))",
  },
  previous: {
    label: "Previous window",
    color: "hsl(var(--muted-foreground))",
  },
} satisfies ChartConfig;

const formatShortDate = (value: string) => {
  if (!value) return value;
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

type PropertyTrendChartProps = {
  series: PropertySeriesPoint[];
};

export default function PropertyTrendChart({
  series,
}: PropertyTrendChartProps) {
  return (
    <div
      className="rounded-xl border border-border-subtle bg-background/40 p-2 shadow-inner sm:p-4"
      aria-hidden="true"
    >
      <ChartContainer
        config={chartConfig}
        className="h-[260px] w-full sm:h-[360px]"
        data-testid="property-trend-chart"
      >
        <LineChart
          data={series}
          margin={{ left: 0, right: 16, top: 12 }}
          accessibilityLayer={false}
        >
          <CartesianGrid
            vertical={false}
            stroke="hsl(var(--border-subtle))"
            strokeDasharray="3 6"
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickLine={false}
            minTickGap={22}
            tickMargin={12}
            tick={{
              fill: "hsl(var(--muted-foreground))",
              fontFamily: "var(--font-mono)",
            }}
          />
          <YAxis
            tickFormatter={(value) => numberFormatter.format(value)}
            axisLine={false}
            tickLine={false}
            width={48}
            tick={{
              fill: "hsl(var(--muted-foreground))",
              fontFamily: "var(--font-mono)",
            }}
          />
          <ChartTooltip
            cursor={{
              stroke: "hsl(var(--border))",
              strokeDasharray: "3 5",
            }}
            content={
              <ChartTooltipContent
                indicator="line"
                className="rounded-xl border-border bg-popover text-popover-foreground shadow-popover"
              />
            }
          />
          <Line
            type="monotone"
            dataKey="current"
            stroke="var(--color-current)"
            strokeWidth={2.75}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="previous"
            stroke="var(--color-previous)"
            strokeWidth={2.25}
            strokeDasharray="5 7"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
