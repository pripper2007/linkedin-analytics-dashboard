'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { TopicMetrics } from '@/lib/types';
import { useIsMobile } from '@/lib/use-is-mobile';

interface TopicPerformanceChartProps {
  data: TopicMetrics[];
}

// Horizontal layout: category names go on the left, no rotation needed.
// Two metrics (impressions and engagement rate) are plotted side by side
// per category — they live on different X axes because impressions are
// in the thousands and ER is a percent under 10.
export default function TopicPerformanceChart({ data }: TopicPerformanceChartProps) {
  const isMobile = useIsMobile();
  const chartData = data.map(item => ({
    name: item.topic,
    'Avg Impressions': item.avgImpressions,
    'Engagement Rate %': item.avgEngagementRate,
    n: item.count,
  }));

  // Fixed height matched with StylePerformanceChart so the two cards
  // align side-by-side: legend baselines at the same Y, chart bottoms
  // flush. 360px fits up to 4 horizontal categories comfortably; with
  // fewer categories the bars just space out more.
  const height = 360;

  return (
    <div className="card">
      <h3 className="section-title">Topic Performance</h3>
      <div className="h-[240px] md:h-[360px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 24, right: isMobile ? 16 : 30, left: 0, bottom: 10 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          {/* Two X axes — impressions bottom, ER top. Recharts requires
              xAxisId on each Bar so it knows which axis a series uses. */}
          <XAxis
            xAxisId="impressions"
            type="number"
            orientation="bottom"
            stroke="var(--accent)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
          />
          <XAxis
            xAxisId="er"
            type="number"
            orientation="top"
            stroke="var(--chart-secondary)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
            domain={[0, 'dataMax + 1']}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="var(--text-secondary)"
            width={isMobile ? 95 : 140}
            tick={{ fontSize: isMobile ? 11 : 13 }}
            interval={0}
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
              if (name === 'Engagement Rate %')
                return [`${v.toFixed(1)}%${suffix}`, name];
              return [`${v.toLocaleString()}${suffix}`, name];
            }}
          />
          <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 8 }} />
          <Bar
            xAxisId="impressions"
            dataKey="Avg Impressions"
            fill="var(--accent)"
            radius={[0, 6, 6, 0]}
          />
          <Bar
            xAxisId="er"
            dataKey="Engagement Rate %"
            fill="var(--chart-secondary)"
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}
