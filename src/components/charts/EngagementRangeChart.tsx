'use client';

import React from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatNumber } from '@/lib/calculations';
import { useIsMobile } from '@/lib/use-is-mobile';

export interface EngagementPoint {
  label: string;
  engagements: number;
  rate: number; // already in percent units (e.g., 2.34)
}

interface Props {
  data: EngagementPoint[];
  mode: 'perPeriod' | 'cumulative';
  bucketLabel: string;
}

export function EngagementRangeChart({ data, mode, bucketLabel }: Props) {
  const isMobile = useIsMobile();
  const title =
    mode === 'cumulative'
      ? 'Engagement — cumulative'
      : bucketLabel === 'daily'
        ? 'Engagement — per day'
        : 'Engagement — per week';
  const engagementsName =
    mode === 'cumulative' ? 'Engagements (cumulative)' : 'Engagements';
  const rateName =
    mode === 'cumulative' ? 'Engagement rate (cumulative)' : 'Engagement rate';

  return (
    <div className="card">
      <h3 className="section-title">{title}</h3>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            interval={Math.max(0, Math.floor(data.length / (isMobile ? 4 : 8)))}
            angle={isMobile ? -45 : 0}
            textAnchor={isMobile ? 'end' : 'middle'}
            height={isMobile ? 50 : 30}
          />
          {/* Pin both axes to start at 0 so the dual-axis zero lines align —
              see FollowersRangeChart for the full explanation. */}
          <YAxis
            yAxisId="left"
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            tickFormatter={(v) => formatNumber(v)}
            width={isMobile ? 40 : 60}
            domain={[0, 'auto']}
            allowDataOverflow={true}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '10px' : '12px' }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={isMobile ? 44 : 60}
            domain={[0, 'auto']}
            allowDataOverflow={true}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
            }}
            formatter={(value, name) => {
              const n = typeof value === 'number' ? value : Number(value);
              return typeof name === 'string' && name.startsWith('Engagement rate')
                ? `${n.toFixed(2)}%`
                : formatNumber(n);
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Legend
            wrapperStyle={{ color: 'var(--text-secondary)' }}
            iconType="line"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="engagements"
            stroke="#057642"
            fill="#057642"
            fillOpacity={0.3}
            name={engagementsName}
            isAnimationActive={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="rate"
            stroke="#b24020"
            strokeWidth={2}
            dot={false}
            name={rateName}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer></div>
    </div>
  );
}
