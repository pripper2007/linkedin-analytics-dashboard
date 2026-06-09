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
import { useIsMobile } from '@/lib/use-is-mobile';

interface NetworkChartsProps {
  monthlyGrowth: { month: string; count: number }[];
  topCompanies: { company: string; count: number }[];
}

export function NetworkCharts({ monthlyGrowth, topCompanies }: NetworkChartsProps) {
  const isMobile = useIsMobile();
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div
          className="p-3 rounded-lg border"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          <p style={{ color: 'var(--text-primary)' }} className="font-medium">
            {d.month || d.company}
          </p>
          <p className="text-sm" style={{ color: 'var(--accent)' }}>
            {payload[0].value} connections
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Monthly Connection Growth */}
      <div className="card">
        <div className="mb-4">
          <h3 className="section-title">Connections Added (Last 12 Months)</h3>
        </div>
        <div className="h-[200px] md:h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyGrowth} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="month"
                stroke="var(--text-secondary)"
                style={{ fontSize: isMobile ? '10px' : '11px' }}
                interval={isMobile ? Math.max(0, Math.floor(monthlyGrowth.length / 4)) : 0}
                angle={isMobile ? -45 : 0}
                textAnchor={isMobile ? 'end' : 'middle'}
                height={isMobile ? 50 : 30}
              />
              <YAxis
                stroke="var(--text-secondary)"
                style={{ fontSize: isMobile ? '10px' : '11px' }}
                width={isMobile ? 32 : 60}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="var(--accent)" radius={[3, 3, 0, 0]} name="New Connections" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Companies */}
      <div className="card">
        <div className="mb-4">
          <h3 className="section-title">Top Companies in Network</h3>
        </div>
        <div className="h-[200px] md:h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topCompanies.slice(0, 10)}
              layout="vertical"
              margin={{ top: 5, right: 10, left: isMobile ? 0 : 80, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" stroke="var(--text-secondary)" style={{ fontSize: isMobile ? '10px' : '11px' }} />
              <YAxis
                type="category"
                dataKey="company"
                stroke="var(--text-secondary)"
                style={{ fontSize: isMobile ? '10px' : '11px' }}
                width={isMobile ? 80 : 75}
                tick={{ fill: 'var(--text-secondary)' }}
                interval={0}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="#8b5cf6" radius={[0, 3, 3, 0]} name="Connections" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
