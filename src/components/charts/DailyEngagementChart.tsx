'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import type { DailyEntry } from '@/lib/types';
import { formatNumber } from '@/lib/calculations';
import { useIsMobile } from '@/lib/use-is-mobile';

interface DailyEngagementChartProps {
  data: DailyEntry[];
}

export function DailyEngagementChart({ data }: DailyEngagementChartProps) {
  const isMobile = useIsMobile();
  // Format data for chart
  const chartData = data.map(entry => ({
    date: new Date(entry.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    impressions: entry.impressions,
    engagements: entry.engagements,
    fullDate: entry.date,
  }));

  // Sample data every 7 days for cleaner X-axis
  const sampledData = chartData.filter((_, i) => i % 7 === 0 || i === chartData.length - 1);

  return (
    <div className="card">
      <h3 className="section-title">Daily Engagement Timeline</h3>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            interval={Math.floor(chartData.length / (isMobile ? 4 : 8))}
            angle={isMobile ? -45 : 0}
            textAnchor={isMobile ? 'end' : 'middle'}
            height={isMobile ? 50 : 30}
          />
          <YAxis
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            tickFormatter={(value) => formatNumber(value)}
            width={isMobile ? 40 : 60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
            }}
            formatter={(value: any) => formatNumber(value)}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Legend
            wrapperStyle={{ color: 'var(--text-secondary)' }}
            iconType="line"
          />
          <Area
            type="monotone"
            dataKey="impressions"
            fill="#0a66c2"
            stroke="#0a66c2"
            fillOpacity={0.3}
            name="Impressions"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="engagements"
            stroke="#057642"
            strokeWidth={2}
            name="Engagements"
            isAnimationActive={false}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer></div>
    </div>
  );
}
