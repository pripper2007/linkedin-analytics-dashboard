'use client';

// Holds the shared Per-period / Cumulative toggle and renders the 3
// range-aware charts below it. Server pre-computes BOTH series shapes
// for each chart and passes them in, so the toggle is a pure client
// swap — no re-fetch, no flicker.

import React, { useState } from 'react';
import {
  FollowersRangeChart,
  type FollowersPoint,
} from '@/components/charts/FollowersRangeChart';
import {
  ImpressionsRangeChart,
  type ImpressionsPoint,
} from '@/components/charts/ImpressionsRangeChart';
import {
  EngagementRangeChart,
  type EngagementPoint,
} from '@/components/charts/EngagementRangeChart';

export type ChartMode = 'perPeriod' | 'cumulative';

interface Series<T> {
  perPeriod: T[];
  cumulative: T[];
}

interface Props {
  bucketSize: 'daily' | 'weekly';
  followers: Series<FollowersPoint>;
  impressions: Series<ImpressionsPoint>;
  engagement: Series<EngagementPoint>;
}

export function RangeCharts({
  bucketSize,
  followers,
  impressions,
  engagement,
}: Props) {
  const [mode, setMode] = useState<ChartMode>('perPeriod');

  const perPeriodLabel = bucketSize === 'daily' ? 'Per day' : 'Per week';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span
          className="text-xs uppercase tracking-wide"
          style={{ color: 'var(--text-muted)' }}
        >
          View
        </span>
        <ToggleButton
          active={mode === 'perPeriod'}
          onClick={() => setMode('perPeriod')}
        >
          {perPeriodLabel}
        </ToggleButton>
        <ToggleButton
          active={mode === 'cumulative'}
          onClick={() => setMode('cumulative')}
        >
          Cumulative
        </ToggleButton>
      </div>

      <FollowersRangeChart
        data={followers[mode]}
        mode={mode}
        bucketLabel={bucketSize}
      />
      <ImpressionsRangeChart
        data={impressions[mode]}
        mode={mode}
        bucketLabel={bucketSize}
      />
      <EngagementRangeChart
        data={engagement[mode]}
        mode={mode}
        bucketLabel={bucketSize}
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm px-3 py-1.5 rounded font-medium transition-colors"
      style={{
        backgroundColor: active ? 'var(--accent)' : 'var(--bg-secondary)',
        color: active ? 'white' : 'var(--text-primary)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  );
}
