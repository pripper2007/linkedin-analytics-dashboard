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

interface DayOfWeekChartProps {
  data: { day: string; avgImpressions: number; avgEngagements: number; count: number }[];
}

export default function DayOfWeekChart({ data }: DayOfWeekChartProps) {
  const isMobile = useIsMobile();
  const chartData = data.filter(d => d.count > 0).map(item => ({
    day: item.day.substring(0, 3),
    'Avg Impressions': item.avgImpressions,
  }));

  // Find the best day
  const bestDay = Math.max(...chartData.map(d => d['Avg Impressions']));
  const bestDayIndex = chartData.findIndex(d => d['Avg Impressions'] === bestDay);

  return (
    <div className="card">
      <h3 className="section-title">Daily Performance by Day of Week</h3>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="day"
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
          />
          <YAxis
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            width={isMobile ? 40 : 60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <Bar dataKey="Avg Impressions" radius={[8, 8, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={index === bestDayIndex ? 'var(--accent)' : 'var(--success)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}
