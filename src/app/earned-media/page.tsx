import React from 'react';
import {
  getDailyEngagement,
  getAllPosts,
} from '@/lib/queries';
import {
  calculateEarnedMediaValue,
  formatNumber,
} from '@/lib/calculations';
import { resolveRange } from '@/lib/date-range';
import { RangeFilter } from '../RangeFilter';

export const dynamic = 'force-dynamic';

// Same CPM / CPC constants used in calculations.ts. Kept local to this
// page so the card copy can reference the exact rates without magic
// numbers scattered in JSX.
const LINKEDIN_CPM = 6.59;
const LINKEDIN_CPC = 5.26;

export default async function EarnedMediaPage({
  searchParams,
}: {
  searchParams?: { range?: string; from?: string; to?: string };
}) {
  const range = resolveRange(searchParams ?? {});

  const [dailyEngagementAll, postsAll] = await Promise.all([
    getDailyEngagement(),
    getAllPosts(),
  ]);

  const dailyEngagement = dailyEngagementAll.filter(
    (d) => d.date >= range.fromIso && d.date <= range.toIso,
  );
  const posts = postsAll.filter((p) => {
    const d = new Date(p.post_date);
    if (isNaN(d.getTime())) return false;
    return d >= range.from && d <= range.to;
  });

  const totalImpressions = dailyEngagement.reduce(
    (s, d) => s + d.impressions,
    0,
  );
  const totalEngagements = dailyEngagement.reduce(
    (s, d) => s + d.engagements,
    0,
  );
  const emv = calculateEarnedMediaValue(totalImpressions, totalEngagements);
  const total = emv.cpmValue + emv.cpcValue;

  return (
    <div className="space-y-6">
      {/* Header + range filter */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Earned Media Value
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {range.label} · estimated equivalent ad spend for the organic
            impressions and clicks you captured · {formatNumber(posts.length)}{' '}
            posts in window
          </p>
        </div>
        <RangeFilter />
      </div>

      {/* Three cards — same framing as the old Exec Summary block, but
          no longer competing for attention with the real KPIs. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            CPM-based value
          </div>
          <div className="text-4xl font-bold mt-2" style={{ color: 'var(--accent)' }}>
            ${emv.cpmValue.toLocaleString()}
          </div>
          <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Cost Per Mille — what an advertiser would pay to reach the
            {' '}{formatNumber(totalImpressions)} impressions your content
            received, @ ${LINKEDIN_CPM} CPM.
          </div>
        </div>

        <div className="card">
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            CPC-based value
          </div>
          <div className="text-4xl font-bold mt-2" style={{ color: 'var(--accent)' }}>
            ${emv.cpcValue.toLocaleString()}
          </div>
          <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Cost Per Click — what an advertiser would pay for the{' '}
            {formatNumber(totalEngagements)} engagements you earned,
            @ ${LINKEDIN_CPC} per click.
          </div>
        </div>

        <div
          className="card border-2"
          style={{ borderColor: 'var(--accent)' }}
        >
          <div className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            Total EMV
          </div>
          <div className="text-4xl font-bold mt-2" style={{ color: 'var(--accent)' }}>
            ${total.toLocaleString()}
          </div>
          <div className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            CPM + CPC combined — a rough proxy for what this content would
            have cost as paid media.
          </div>
        </div>
      </div>

      {/* Methodology footnote — so future-you remembers where 6.59 / 5.26
          came from. Industry-standard LinkedIn benchmarks for 2024/2025. */}
      <div
        className="text-xs leading-relaxed"
        style={{ color: 'var(--text-muted)' }}
      >
        <strong style={{ color: 'var(--text-secondary)' }}>Methodology:</strong>{' '}
        CPM and CPC rates reflect published 2024–2025 LinkedIn ads
        benchmarks (${LINKEDIN_CPM} CPM, ${LINKEDIN_CPC} CPC). EMV is a
        simplified convention for "what did this organic reach save me
        vs. paying for equivalent ads" — useful for ballpark framing, not
        an accurate market bid. Your audience quality, geo, and timing
        move real auction prices by a lot.
      </div>
    </div>
  );
}
