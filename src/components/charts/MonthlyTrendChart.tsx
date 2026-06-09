'use client';

import React from 'react';
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
import { formatNumber } from '@/lib/calculations';
import { useIsMobile } from '@/lib/use-is-mobile';

interface MonthlyData {
  month: string;
  impressions: number;
  engagements: number;
  avgDaily: number;
}

interface ExtendedMonthlyData extends MonthlyData {
  change?: string;
}

export function MonthlyTrendChart({ data }: { data: MonthlyData[] }) {
  const isMobile = useIsMobile();
  // Add month-over-month % change
  const extendedData: ExtendedMonthlyData[] = data.map((item, idx) => {
    let change = '';
    if (idx > 0) {
      const prevImpressions = data[idx - 1].impressions;
      const percentChange = Math.round(
        ((item.impressions - prevImpressions) / prevImpressions) * 100
      );
      change = `${percentChange >= 0 ? '+' : ''}${percentChange}%`;
    }
    return { ...item, change };
  });

  // Format month labels as "Jan", "Feb", etc.
  const formattedData = extendedData.map(item => ({
    ...item,
    monthLabel: new Date(item.month + '-01').toLocaleDateString('en-US', {
      month: 'short',
    }),
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div
          className="p-3 rounded-lg border"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          <p style={{ color: 'var(--text-primary)' }} className="font-medium">
            {data.monthLabel}
          </p>
          <p style={{ color: 'var(--accent)' }} className="text-sm">
            Impressions: {formatNumber(data.impressions)}
          </p>
          {data.change && (
            <p
              className="text-sm"
              style={{
                color: data.change.startsWith('-')
                  ? 'var(--warning)'
                  : 'var(--success)',
              }}
            >
              MoM: {data.change}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="card">
      <div className="mb-6">
        <h3 className="section-title">Monthly Impressions Trend</h3>
        <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
          12-month impression history with month-over-month change
        </p>
      </div>

      <div className="h-[260px] md:h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={formattedData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="monthLabel"
              stroke="var(--text-secondary)"
              style={{ fontSize: isMobile ? '10px' : '12px' }}
              interval={isMobile ? Math.max(0, Math.floor(data.length / 4)) : 0}
              angle={isMobile ? -45 : 0}
              textAnchor={isMobile ? 'end' : 'middle'}
              height={isMobile ? 50 : 30}
            />
            <YAxis
              stroke="var(--text-secondary)"
              style={{ fontSize: isMobile ? '10px' : '12px' }}
              tickFormatter={(value) => formatNumber(value)}
              width={isMobile ? 40 : 60}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="impressions"
              stroke="var(--accent)"
              dot={{ fill: 'var(--accent)', r: 4 }}
              activeDot={{ r: 6 }}
              strokeWidth={2}
              name="Monthly Impressions"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Month-over-Month annotations */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {extendedData.slice(-4).map((item, idx) => (
          <div
            key={item.month}
            className="card-sm text-center"
            style={{ borderColor: 'var(--border)' }}
          >
            <p style={{ color: 'var(--text-secondary)' }} className="text-xs mb-1">
              {new Date(item.month + '-01').toLocaleDateString('en-US', {
                month: 'short',
                year: 'numeric',
              })}
            </p>
            <p style={{ color: 'var(--text-primary)' }} className="font-bold">
              {formatNumber(item.impressions)}
            </p>
            {item.change && (
              <p
                className="text-xs font-medium mt-1"
                style={{
                  color: item.change.startsWith('-')
                    ? 'var(--warning)'
                    : 'var(--success)',
                }}
              >
                {item.change}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
