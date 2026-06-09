'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import type { Post } from '@/lib/types';
import { formatNumber } from '@/lib/calculations';
import { useIsMobile } from '@/lib/use-is-mobile';

interface EngagementFunnelProps {
  post: Post;
}

export function EngagementFunnel({ post }: EngagementFunnelProps) {
  const isMobile = useIsMobile();
  const funnelData = [
    {
      stage: 'Impressions',
      value: post.impressions,
      percent: 100,
    },
    {
      stage: 'Reached',
      value: post.members_reached,
      percent: post.impressions > 0 ? Math.round((post.members_reached / post.impressions) * 100) : 0,
    },
    {
      stage: 'Engagements',
      value: post.social_engagements,
      percent: post.impressions > 0 ? Math.round((post.social_engagements / post.impressions) * 100) : 0,
    },
    {
      stage: 'Reactions',
      value: post.reactions,
      percent: post.impressions > 0 ? Math.round((post.reactions / post.impressions) * 100) : 0,
    },
    {
      stage: 'Comments',
      value: post.comments,
      percent: post.impressions > 0 ? Math.round((post.comments / post.impressions) * 100) : 0,
    },
    {
      stage: 'Reposts',
      value: post.reposts,
      percent: post.impressions > 0 ? Math.round((post.reposts / post.impressions) * 100) : 0,
    },
    {
      stage: 'Saves',
      value: post.saves,
      percent: post.impressions > 0 ? Math.round((post.saves / post.impressions) * 100) : 0,
    },
  ];

  const colors = [
    '#0a66c2',
    '#3b82f6',
    '#60a5fa',
    '#93c5fd',
    '#bfdbfe',
    '#dbeafe',
    '#f0f9ff',
  ];

  return (
    <div className="card">
      <h3 className="section-title">Engagement Funnel</h3>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={funnelData}
          margin={{ top: 5, right: 30, left: isMobile ? 0 : 120, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" stroke="var(--text-muted)" style={{ fontSize: isMobile ? '11px' : '12px' }} />
          <YAxis
            type="category"
            dataKey="stage"
            stroke="var(--text-muted)"
            style={{ fontSize: isMobile ? '11px' : '12px' }}
            width={isMobile ? 90 : 60}
            interval={0}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
            }}
            formatter={(value: any, name) => {
              if (name === 'value') return formatNumber(value);
              return value;
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Bar dataKey="value" name="Count">
            {funnelData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer></div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {funnelData.map((item, idx) => (
          <div key={idx} className="p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div style={{ color: 'var(--text-muted)' }}>{item.stage}</div>
            <div style={{ color: 'var(--accent)', fontWeight: 'bold' }}>
              {formatNumber(item.value)}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              {item.percent}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
