import React from 'react';

export interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  subtitle?: string;
}

export function MetricCard({
  label,
  value,
  change,
  changeType = 'neutral',
  subtitle,
}: MetricCardProps) {
  const changeClasses = {
    positive: 'metric-change-positive',
    negative: 'metric-change-negative',
    neutral: 'metric-label',
  };

  return (
    <div className="card">
      <div className="metric-label">{label}</div>
      <div className="metric-value my-2">{value}</div>
      {change && (
        <div className={changeClasses[changeType]}>{change}</div>
      )}
      {subtitle && (
        <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
