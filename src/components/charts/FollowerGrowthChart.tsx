'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { FollowerHistoryPoint } from '@/lib/queries';
import { formatNumber } from '@/lib/calculations';
import { useIsMobile } from '@/lib/use-is-mobile';

interface Props {
  data: FollowerHistoryPoint[];
}

/**
 * 13-month (or longer) follower-count trend, fed by the
 * profile_snapshots backfill. Shows total followers over time so MoM
 * and YoY comparisons are eyeball-visible without drilling into SQL.
 */
export function FollowerGrowthChart({ data }: Props) {
  const isMobile = useIsMobile();
  const chartData = data.map((d) => ({
    date: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    fullDate: d.date,
    total_followers: d.total_followers,
  }));
  // Sample to ~40 ticks max — readable on mobile, still smooth visually.
  const step = Math.max(1, Math.ceil(chartData.length / 40));
  const sampled = chartData.filter((_, i) => i % step === 0 || i === chartData.length - 1);

  const startTotal = data[0]?.total_followers ?? 0;
  const endTotal = data[data.length - 1]?.total_followers ?? 0;
  const delta = endTotal - startTotal;
  const startDateLabel = data[0]
    ? new Date(`${data[0].date}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : '';
  const endDateLabel = data[data.length - 1]
    ? new Date(
        `${data[data.length - 1].date}T00:00:00Z`,
      ).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="section-title">Follower Growth</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {startDateLabel} → {endDateLabel}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold" style={{ color: 'var(--accent)' }}>
            +{formatNumber(delta)}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatNumber(startTotal)} → {formatNumber(endTotal)}
          </div>
        </div>
      </div>
      <div className="h-[220px] md:h-[320px]"><ResponsiveContainer width="100%" height="100%">
        <AreaChart data={sampled}>
          <defs>
            <linearGradient id="follower-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.45} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            stroke="var(--text-muted)"
            tick={{ fontSize: isMobile ? 10 : 11 }}
            interval={Math.max(0, Math.floor(sampled.length / (isMobile ? 4 : 8)))}
            angle={isMobile ? -45 : 0}
            textAnchor={isMobile ? 'end' : 'middle'}
            height={isMobile ? 50 : 30}
          />
          <YAxis
            stroke="var(--text-muted)"
            tick={{ fontSize: isMobile ? 10 : 11 }}
            tickFormatter={(n: number) => formatNumber(n)}
            domain={['dataMin - 100', 'dataMax + 100']}
            width={isMobile ? 40 : 60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            formatter={(v) => [formatNumber(Number(v ?? 0)), 'Followers']}
          />
          <Area
            type="monotone"
            dataKey="total_followers"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#follower-grad)"
          />
        </AreaChart>
      </ResponsiveContainer></div>
    </div>
  );
}
