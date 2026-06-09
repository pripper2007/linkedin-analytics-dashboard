'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useIsMobile } from '@/lib/use-is-mobile';

interface WordCountChartProps {
  data: { range: string; avgImpressions: number; count: number }[];
}

export default function WordCountChart({ data }: WordCountChartProps) {
  const isMobile = useIsMobile();
  const chartData = data.map(item => ({
    name: item.range,
    'Avg Impressions': item.avgImpressions,
    n: item.count,
  }));

  // Best bucket = highest avg impressions among buckets with at least one
  // post. Previously the "sweet spot" was hardcoded to "151-200" — which
  // could disagree with what the data actually said.
  const bestBucket = chartData.reduce<{ name: string; value: number } | null>(
    (best, cur) => {
      if (cur.n === 0) return best;
      const val = cur['Avg Impressions'];
      if (best == null || val > best.value) return { name: cur.name, value: val };
      return best;
    },
    null,
  );
  const sweetSpotIndex = bestBucket
    ? chartData.findIndex((c) => c.name === bestBucket.name)
    : -1;

  return (
    <div className="card">
      <h3 className="section-title">Word Count Impact</h3>
      <p className="metric-label mb-4">
        {bestBucket
          ? `Best-performing length: ${bestBucket.name} words`
          : 'No data yet'}
      </p>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="name"
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '11px' : '12px' }}
          />
          <YAxis
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '11px' : '12px' }}
            width={isMobile ? 40 : 60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
            formatter={(value, name, item) => {
              const v = typeof value === 'number' ? value : Number(value);
              const n = (item as { payload?: { n: number } }).payload?.n;
              const suffix = n != null ? ` · n=${n}` : '';
              return [`${v.toLocaleString()}${suffix}`, name];
            }}
          />
          <Bar dataKey="Avg Impressions" radius={[8, 8, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={index === sweetSpotIndex ? 'var(--accent)' : 'var(--success)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}
