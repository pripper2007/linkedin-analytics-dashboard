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

export interface FollowersPoint {
  label: string;
  value: number;
  /**
   * Net new followers ÷ posts in this bucket (per-period) OR running
   * follower gain ÷ running post count so far (cumulative). Shown on
   * the secondary Y-axis.
   */
  followersPerPost: number;
}

interface Props {
  data: FollowersPoint[];
  mode: 'perPeriod' | 'cumulative';
  bucketLabel: string; // "daily" | "weekly"
}

export function FollowersRangeChart({ data, mode, bucketLabel }: Props) {
  const isMobile = useIsMobile();
  const title =
    mode === 'cumulative'
      ? 'Followers — cumulative'
      : bucketLabel === 'daily'
        ? 'Followers — new per day'
        : 'Followers — new per week';
  const seriesName = mode === 'cumulative' ? 'Total followers' : 'New followers';
  const perPostName =
    mode === 'cumulative' ? 'Followers per post (cumulative)' : 'New followers / post';

  return (
    <div className="card">
      <h3 className="section-title">{title}</h3>
      <div className="h-[200px] md:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
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
          {/* Pin both axes to start at 0 with allowDataOverflow={true} to
              prevent Recharts' "nice tick" rounding from re-expanding the
              domain below 0. With just domain={[0,'auto']} (no overflow
              flag), the tick algorithm can pick a step like 80 for a data
              range of 0–200 and synthesize ticks at -80 → 240 to land on
              "nice" multiples of 80, dragging the lower bound negative.
              allowDataOverflow=true tells Recharts to enforce the explicit
              bounds even if the resulting ticks aren't perfectly even. */}
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
            tickFormatter={(v: number) => Number.isInteger(v) ? `${v}` : v.toFixed(1)}
            width={isMobile ? 36 : 60}
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
              return typeof name === 'string' && name.includes('per post')
                ? n.toFixed(2)
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
            dataKey="value"
            stroke="#0a66c2"
            fill="#0a66c2"
            fillOpacity={0.3}
            name={seriesName}
            isAnimationActive={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="followersPerPost"
            stroke="#b24020"
            strokeWidth={2}
            dot={false}
            name={perPostName}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
