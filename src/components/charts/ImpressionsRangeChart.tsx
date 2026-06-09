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

export interface ImpressionsPoint {
  label: string;
  value: number;
  /**
   * Impressions ÷ posts in this bucket (per-period) OR running
   * impressions ÷ running post count so far (cumulative). Shown on
   * the secondary Y-axis.
   */
  impressionsPerPost: number;
}

interface Props {
  data: ImpressionsPoint[];
  mode: 'perPeriod' | 'cumulative';
  bucketLabel: string; // "daily" | "weekly"
}

export function ImpressionsRangeChart({ data, mode, bucketLabel }: Props) {
  const isMobile = useIsMobile();
  const title =
    mode === 'cumulative'
      ? 'Impressions — cumulative'
      : bucketLabel === 'daily'
        ? 'Impressions — per day'
        : 'Impressions — per week';
  const perPostName =
    mode === 'cumulative'
      ? 'Impressions per post (cumulative)'
      : 'Impressions / post';

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
            tickFormatter={(v: number) => formatNumber(v)}
            width={isMobile ? 40 : 60}
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
            formatter={(v) => formatNumber(typeof v === 'number' ? v : Number(v))}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Legend
            wrapperStyle={{ color: 'var(--text-secondary)' }}
            iconType="line"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="value"
            stroke="#0a66c2"
            fill="#0a66c2"
            fillOpacity={0.3}
            name="Impressions"
            isAnimationActive={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="impressionsPerPost"
            stroke="#b24020"
            strokeWidth={2}
            dot={false}
            name={perPostName}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer></div>
    </div>
  );
}
