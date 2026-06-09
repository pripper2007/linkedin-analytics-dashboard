'use client';

// Day-of-week × time-of-day posting heatmap. Every cell shows the avg
// impressions of posts published in that (day, bucket) window, with
// color intensity scaled to the maximum cell. Hover reveals n and ER.
//
// Buckets are São Paulo–local (BRT) and intentionally Pedro's daily
// rhythm: Manhã 06–12h, Tarde 12–18h, Noite 18–06h (includes madrugada).

import type {
  PostingHeatmapCell,
  PostingHeatmapBucket,
} from '@/lib/calculations';
import { POSTING_HEATMAP_BUCKETS } from '@/lib/calculations';

interface Props {
  data: PostingHeatmapCell[];
}

const DAY_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const DAY_SHORT: Record<(typeof DAY_ORDER)[number], string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

const BUCKET_HOURS: Record<PostingHeatmapBucket, string> = {
  'Manhã': '06–12h',
  'Tarde': '12–18h',
  'Noite': '18–06h',
};

export default function PostingHeatmap({ data }: Props) {
  // Find the max avg impressions across non-empty cells; we scale the
  // cell colors against this. Empty cells stay neutral background.
  const maxImpressions = data.reduce(
    (m, c) => (c.count > 0 && c.avgImpressions > m ? c.avgImpressions : m),
    0,
  );

  // Lookup helper.
  const cellMap = new Map<string, PostingHeatmapCell>();
  for (const c of data) cellMap.set(`${c.day}|${c.bucket}`, c);

  const cellColor = (avg: number, count: number): string => {
    if (count === 0) return 'var(--bg-secondary)';
    if (maxImpressions <= 0) return 'var(--bg-secondary)';
    const t = Math.min(1, avg / maxImpressions);
    // Tail-off for low-confidence cells (n=1 or 2): keep the color but
    // reduce opacity through CSS so the user reads it as "less reliable".
    const lightness = 95 - 60 * t; // 95% (light) → 35% (dark)
    return `hsl(217, 91%, ${lightness}%)`;
  };

  const textColor = (avg: number, count: number): string => {
    if (count === 0) return 'var(--text-muted)';
    const t = Math.min(1, avg / Math.max(maxImpressions, 1));
    return t > 0.55 ? '#ffffff' : 'var(--text-primary)';
  };

  return (
    <div className="card">
      <h3 className="section-title">Posting Heatmap (day × time)</h3>
      <p className="metric-label mb-4">
        Avg impressions per post by day of week and time of day (São Paulo
        local). Cells with no posts are gray; cells get darker as average
        impressions go up.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left font-medium text-xs px-2"
                  style={{ color: 'var(--text-secondary)' }}>
                Day \ Bucket
              </th>
              {POSTING_HEATMAP_BUCKETS.map((b) => (
                <th
                  key={b}
                  className="font-medium text-xs px-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {b}
                  <div
                    className="text-[10px] font-normal"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {BUCKET_HOURS[b]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_ORDER.map((day) => (
              <tr key={day}>
                <td
                  className="font-medium text-xs px-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {DAY_SHORT[day]}
                </td>
                {POSTING_HEATMAP_BUCKETS.map((bucket) => {
                  const cell =
                    cellMap.get(`${day}|${bucket}`) ?? null;
                  const count = cell?.count ?? 0;
                  const avg = cell?.avgImpressions ?? 0;
                  const er = cell?.avgEngagementRate ?? 0;
                  const tooltip =
                    count === 0
                      ? `${day} · ${bucket}: no posts`
                      : `${day} · ${bucket}: ${avg.toLocaleString()} avg impressions · ${er.toFixed(2)}% ER · n=${count}`;
                  return (
                    <td
                      key={bucket}
                      title={tooltip}
                      className="text-center rounded-md py-3 px-3 font-medium tabular-nums transition"
                      style={{
                        backgroundColor: cellColor(avg, count),
                        color: textColor(avg, count),
                        minWidth: 110,
                      }}
                    >
                      {count === 0 ? (
                        <span className="text-xs opacity-60">—</span>
                      ) : (
                        <>
                          <div>{avg.toLocaleString()}</div>
                          <div
                            className="text-[10px] opacity-80"
                            style={{ fontWeight: 400 }}
                          >
                            n={count}
                          </div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
