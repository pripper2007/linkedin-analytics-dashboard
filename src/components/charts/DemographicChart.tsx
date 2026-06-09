'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DemographicEntry } from '@/lib/types';
import { useIsMobile } from '@/lib/use-is-mobile';

interface DemographicChartProps {
  title: string;
  data: DemographicEntry[];
}

export function DemographicChart({ title, data }: DemographicChartProps) {
  const isMobile = useIsMobile();
  if (!data || data.length === 0) {
    return null;
  }

  // Parse percentage values
  const chartData = data.slice(0, 8).map(entry => ({
    name: entry.value,
    percentage: parseFloat(entry.pct.replace('%', '').replace('<', '').trim()) || 0,
  }));

  return (
    <div className="card">
      <h4 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h4>
      <div className="h-[180px] md:h-[250px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 5, right: 30, left: isMobile ? 0 : 150, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            stroke="var(--text-muted)"
            style={{ fontSize: '12px' }}
            label={{ value: '%', position: 'insideRight', offset: -5 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '10px' : '11px' }}
            width={isMobile ? 90 : 140}
            interval={0}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
            }}
            formatter={(value: any) => `${value.toFixed(1)}%`}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Bar dataKey="percentage" fill="#0a66c2" />
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}
