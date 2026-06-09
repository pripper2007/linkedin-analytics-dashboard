'use client';

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

interface DemographicBarChartProps {
  title: string;
  /** Short subtitle under the title, plain English: WHAT this measures. */
  subtitle?: string;
  data: { name: string; value: number }[];
  maxItems?: number;
  /** 'percent' (default) renders "6.5%". 'count' renders "1.2K" / raw int. */
  unit?: 'percent' | 'count';
  unitLabel?: string;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

// All six audience charts use this same component (we used to mix bar
// charts with pie charts for seniority + company size, but Pedro found
// the unit ambiguity and visual inconsistency hurt readability — every
// number on this page is "average % of audience across posts with
// demographics", so they all read better as the same chart).
export default function DemographicBarChart({
  title,
  subtitle,
  data,
  maxItems = 10,
  unit = 'percent',
  unitLabel,
}: DemographicBarChartProps) {
  const chartData = data.sort((a, b) => b.value - a.value).slice(0, maxItems);
  const isCount = unit === 'count';
  const tooltipLabel = unitLabel ?? (isCount ? 'Estimated reach' : 'Audience share');
  const isMobile = useIsMobile();
  // YAxis category labels can be long ("Greater São Paulo Area"); on
  // desktop we give them 190px so they render in full. On mobile that
  // leaves <100px for the bars themselves, so we shrink to ~95px and
  // accept that long labels will truncate.
  const yAxisWidth = isMobile ? 95 : 190;

  return (
    <div className="card">
      <h3
        className="text-lg font-semibold mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      {subtitle && (
        <p
          className="text-sm mb-4 leading-snug"
          style={{ color: 'var(--text-secondary)' }}
        >
          {subtitle}
        </p>
      )}
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 60, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            stroke="var(--text-secondary)"
            tickFormatter={(v) => (isCount ? formatCount(v) : `${v}%`)}
          />
          <YAxis
            dataKey="name"
            type="category"
            stroke="var(--text-secondary)"
            width={yAxisWidth}
            tick={{ fontSize: isMobile ? 11 : 12 }}
            interval={0}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
            formatter={(value) => {
              const v = typeof value === 'number' ? value : Number(value);
              return [
                isCount ? formatCount(v) : `${v.toFixed(1)}%`,
                tooltipLabel,
              ];
            }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[0, 8, 8, 0]}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v) => {
                const n = typeof v === 'number' ? v : Number(v);
                if (!Number.isFinite(n)) return '';
                return isCount ? formatCount(n) : `${n.toFixed(1)}%`;
              }}
              fill="var(--text-primary)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}
