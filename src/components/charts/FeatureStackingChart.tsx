'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useIsMobile } from '@/lib/use-is-mobile';

interface FeatureStackingChartProps {
  data: { featureCount: number; avgImpressions: number; avgEngagement: number; count: number }[];
}

export default function FeatureStackingChart({ data }: FeatureStackingChartProps) {
  const isMobile = useIsMobile();
  const chartData = data.map(item => ({
    name: item.featureCount.toString(),
    featureCount: item.featureCount,
    'Avg Impressions': item.avgImpressions,
    'Count': item.count,
  }));

  return (
    <div className="card">
      <h3 className="section-title">Feature Stacking Impact</h3>
      <p className="metric-label mb-4">Impressions by number of features included</p>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="name"
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '11px' : '12px' }}
            label={isMobile ? undefined : { value: 'Number of Features', position: 'insideBottomRight', offset: -5 }}
          />
          {/* Drop the rotated YAxis label on mobile — it overlaps the
              tick numbers on narrow viewports and the chart subtitle
              already says "Impressions by number of features". */}
          <YAxis
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '11px' : '12px' }}
            width={isMobile ? 40 : 60}
            label={isMobile ? undefined : { value: 'Avg Impressions', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="Avg Impressions"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ fill: 'var(--accent)', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer></div>
    </div>
  );
}
