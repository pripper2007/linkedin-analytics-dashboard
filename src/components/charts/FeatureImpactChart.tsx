'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { FeatureImpact } from '@/lib/types';
import { useIsMobile } from '@/lib/use-is-mobile';

interface FeatureImpactChartProps {
  data: FeatureImpact[];
}

// Two-part confidence rule for coloring a feature's impact bar:
//
//   1. min(withN, withoutN) >= MIN_BUCKET — we need enough posts on
//      BOTH sides of the comparison.
//   2. |impact| >= MIN_EFFECT_PCT — the magnitude has to be meaningful.
//      A "-9% on 21 vs 29 posts" result mathematically exists but is
//      well within the noise floor of a self-reported per-post sample.
//
// If either fails, the bar paints gray and the tooltip says so —
// it might still be true, but we don't have the data to claim it.
const MIN_BUCKET = 15;
const MIN_EFFECT_PCT = 15;

export default function FeatureImpactChart({ data }: FeatureImpactChartProps) {
  const isMobile = useIsMobile();
  const chartData = data.map((item) => {
    const minN = Math.min(item.withFeature.count, item.withoutFeature.count);
    const tooThin = minN < MIN_BUCKET;
    const tooSmall = Math.abs(item.impactPct) < MIN_EFFECT_PCT;
    const lowConfidence = tooThin || tooSmall;
    return {
      name: item.feature,
      impact: item.impactPct,
      withN: item.withFeature.count,
      withoutN: item.withoutFeature.count,
      lowConfidence,
      reason: tooThin && tooSmall
        ? 'thin sample, small effect'
        : tooThin
          ? 'thin sample'
          : tooSmall
            ? 'small effect'
            : null,
    };
  });

  const colorFor = (impact: number, lowConfidence: boolean): string => {
    if (lowConfidence) return 'var(--text-muted)';
    // Positive bars use the project's accent (blue); negative bars use
    // the warning color (orange/red) so the direction-and-color pairing
    // still reads correctly. Neither side uses green — the dashboard
    // unified its palette around blue/violet to align with Bemobi.
    return impact >= 0 ? 'var(--accent)' : 'var(--warning)';
  };

  return (
    <div className="card">
      <h3 className="section-title">Feature Impact on Impressions</h3>
      <p className="metric-label mb-4">
        % change vs. posts without the feature. Gray bars = signal not
        trustworthy (need ≥{MIN_BUCKET} posts on each side AND |effect|
        ≥{MIN_EFFECT_PCT}%; below either bar, the difference can be
        confounding from post type rather than the feature itself).
      </p>
      <ul
        className="text-xs mb-3 space-y-1 list-disc pl-5"
        style={{ color: 'var(--text-muted)' }}
      >
        <li>
          <strong>External Link</strong> negative is consistent with
          LinkedIn&apos;s well-documented preference for keeping users
          on-platform — community consensus.
        </li>
        <li>
          <strong>Bold Unicode</strong>: external research finds{' '}
          <em>no direct algorithm penalty</em>; bold-as-mathematical-symbols
          can hurt screen-reader accessibility but doesn&apos;t trigger
          reach throttling. The slight negative in our data is more likely
          confounding — your non-bold posts may include announcements or
          other high-reach content the algorithm boosts independent of
          formatting. Treat as inconclusive until we stratify by post type.
        </li>
      </ul>
      <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: isMobile ? 0 : 150, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            stroke="var(--text-secondary)"
            style={{ fontSize: isMobile ? '11px' : '12px' }}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            dataKey="name"
            type="category"
            stroke="var(--text-secondary)"
            width={isMobile ? 90 : 140}
            tick={{ fontSize: isMobile ? 11 : 12 }}
            interval={0}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
            formatter={(value, _name, item) => {
              const v = typeof value === 'number' ? value : Number(value);
              const payload = (item as { payload?: typeof chartData[number] })
                .payload;
              const detail = payload
                ? ` (n=${payload.withN} with / ${payload.withoutN} without${
                    payload.lowConfidence
                      ? ` — low confidence: ${payload.reason}`
                      : ''
                  })`
                : '';
              return [`${v}%${detail}`, 'Impact'];
            }}
          />
          <Bar dataKey="impact" radius={[0, 8, 8, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={colorFor(entry.impact, entry.lowConfidence)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer></div>
    </div>
  );
}
