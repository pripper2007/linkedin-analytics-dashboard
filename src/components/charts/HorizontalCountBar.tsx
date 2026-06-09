'use client';

// Generic horizontal bar chart with raw integer counts at the right
// edge of each bar. Used by the Activity page for "people you engage
// with" and "how you react" — both are simple count-based rankings.
// Distinct from DemographicBarChart (which formats values as %).

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { useIsMobile } from '@/lib/use-is-mobile';

interface HorizontalCountBarProps {
  data: { name: string; count: number }[];
  /** Singular label used in tooltip and pluralized as `${label}s`. */
  unitLabel?: string;
  /** Min height (px) when there are few rows. */
  minHeight?: number;
  /** Per-row height (px) for sizing the chart. */
  rowHeight?: number;
  /** Y-axis category column width. */
  yAxisWidth?: number;
}

export default function HorizontalCountBar({
  data,
  unitLabel = 'event',
  minHeight = 180,
  rowHeight = 28,
  yAxisWidth = 170,
}: HorizontalCountBarProps) {
  const isMobile = useIsMobile();
  // Mobile YAxis: ~95px instead of the 170px desktop default. Long
  // names truncate but bars actually have room to render.
  const effectiveYAxisWidth = isMobile ? 95 : yAxisWidth;
  const height = Math.max(minHeight, data.length * rowHeight);
  // Mobile aspect ratio: cap chart height at ~70% of desktop so the
  // chart doesn't look stretched on narrow viewports. Desktop height
  // is passed via inline CSS variable; Tailwind's md: breakpoint
  // switches to it at >=768px. The CSS var pattern is needed because
  // Tailwind arbitrary values can't interpolate component props at
  // build time.
  const desktopHeight = `${height}px`;
  const mobileHeight = `${Math.max(180, Math.round(height * 0.7))}px`;

  return (
    <div
      className="md:h-[var(--ch-desktop)]"
      style={{
        height: mobileHeight,
        ['--ch-desktop' as string]: desktopHeight,
      }}
    >
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 50, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" stroke="var(--text-secondary)" allowDecimals={false} />
        <YAxis
          dataKey="name"
          type="category"
          stroke="var(--text-secondary)"
          width={effectiveYAxisWidth}
          tick={{ fontSize: isMobile ? 11 : 12 }}
          // interval={0} forces Recharts to render EVERY category label.
          // Without it, Recharts heuristically drops every other label
          // when it thinks they won't fit (e.g. wrapped 2-line names like
          // "Felipe de Castro Oliveira") — but that visually orphans the
          // bars between the rendered labels. Better to wrap labels and
          // accept some compression than silently hide them.
          interval={0}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          formatter={(v) => {
            const n = typeof v === 'number' ? v : Number(v);
            return [
              `${n.toLocaleString()} ${unitLabel}${n === 1 ? '' : 's'}`,
              'Count',
            ];
          }}
        />
        <Bar dataKey="count" fill="var(--accent)" radius={[0, 8, 8, 0]}>
          <LabelList
            dataKey="count"
            position="right"
            fill="var(--text-primary)"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
