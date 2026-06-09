'use client';

// Day-of-week × time-of-day, as ONE coherent chart.
//
// Layout (CSS grid, 8 columns: 1 left-label + 7 day columns):
//
//             | Mon | Tue | Wed | Thu | Fri | Sat | Sun
//   ──────────┼─────┴─────┴─────┴─────┴─────┴─────┴─────
//             |  ▓     ▓                 ▓
//   Per-day   |  ▓     ▓     ▓     ▓     ▓     ▓     ▓
//   bars      |  ▓     ▓     ▓     ▓     ▓     ▓     ▓
//             |  ▓     ▓     ▓     ▓     ▓     ▓     ▓
//   ──────────┼─────────────────────────────────────────
//   Manhã     | cell  cell  cell  cell  cell  cell  cell
//   06–12h    |
//   ──────────┼─────────────────────────────────────────
//   Tarde     | cell  cell  cell  cell  cell  cell  cell
//   12–18h    |
//   ──────────┼─────────────────────────────────────────
//   Noite     | cell  cell  cell  cell  cell  cell  cell
//   18–06h    |
//
// The bars and heatmap share the same 7-column grid so the column for
// "Mon" in the bar row sits exactly above the "Mon" cells in every
// heatmap row. This is the alignment Pedro asked for: read the BAR
// chart for "best day overall", then drop your eye straight down the
// column to see WHICH bucket inside that day did the work.
//
// Why custom layout (not Recharts): Recharts auto-sizes bar widths
// based on chart geometry, so a Recharts bar chart and an HTML grid
// below it never align pixel-perfect. Hand-rendering the bars as
// flex children of a 7-column grid gives us deterministic alignment.

import type { PostingHeatmapCell } from '@/lib/calculations';
import { POSTING_HEATMAP_BUCKETS } from '@/lib/calculations';

interface Props {
  /** 7×3 grid of (day, bucket) cells — output of calculatePostingHeatmap. */
  heatmap: PostingHeatmapCell[];
  /**
   * 7-row per-post day-of-week aggregate. Must be sourced from the same
   * posts array as `heatmap` (i.e. calculatePerPostDayOfWeek) — that
   * guarantees each day's avgImpressions is the count-weighted average
   * of its three buckets, so bars and cells share the same unit
   * ("avg impressions per post") and reconcile arithmetically.
   */
  dayOfWeek: {
    day: string;
    avgImpressions: number;
    avgEngagements: number;
    count: number;
  }[];
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

const BUCKET_HOURS: Record<(typeof POSTING_HEATMAP_BUCKETS)[number], string> = {
  'Manhã': '06–12h',
  'Tarde': '12–18h',
  'Noite': '18–06h',
};

export default function DayHourPerformance({ heatmap, dayOfWeek }: Props) {
  // Bar normalization — find the max so we can scale heights.
  const maxBar = dayOfWeek.reduce(
    (m, d) => (d.count > 0 && d.avgImpressions > m ? d.avgImpressions : m),
    0,
  );

  const dayByName = new Map(dayOfWeek.map((d) => [d.day, d]));

  // Heatmap normalization — same idea but only over non-empty cells.
  const maxCell = heatmap.reduce(
    (m, c) => (c.count > 0 && c.avgImpressions > m ? c.avgImpressions : m),
    0,
  );
  const cellMap = new Map<string, PostingHeatmapCell>();
  for (const c of heatmap) cellMap.set(`${c.day}|${c.bucket}`, c);

  // Single blue ramp shared by both the bars and the heatmap cells:
  // input is the post's avg, max is whatever max applies to that
  // section (bar row uses maxBar, heatmap uses maxCell). The output
  // mirrors `--accent` (HSL ~217°) at varying lightness.
  const blueFor = (avg: number, count: number, max: number): string => {
    if (count === 0 || max <= 0) return 'var(--bg-secondary)';
    const t = Math.min(1, avg / max);
    const lightness = 95 - 60 * t;
    return `hsl(217, 91%, ${lightness}%)`;
  };

  const textOnBlue = (avg: number, count: number, max: number): string => {
    if (count === 0) return 'var(--text-muted)';
    const t = Math.min(1, avg / Math.max(max, 1));
    return t > 0.55 ? '#ffffff' : 'var(--text-primary)';
  };

  const cellColor = (avg: number, count: number) =>
    blueFor(avg, count, maxCell);
  const cellTextColor = (avg: number, count: number) =>
    textOnBlue(avg, count, maxCell);

  // Identify the strongest cell — used in the conclusions block.
  const strongestCell = heatmap
    .filter((c) => c.count >= 3)
    .reduce<PostingHeatmapCell | null>(
      (best, cur) =>
        best == null || cur.avgImpressions > best.avgImpressions ? cur : best,
      null,
    );
  const strongestDay = dayOfWeek.reduce<{ day: string; avg: number }>(
    (best, d) =>
      d.count > 0 && d.avgImpressions > best.avg
        ? { day: d.day, avg: d.avgImpressions }
        : best,
    { day: '', avg: 0 },
  );

  // Cells whose sample size is meaningful enough to read as signal.
  const meaningfulCells = heatmap.filter((c) => c.count >= 3);
  const totalCells = 21; // 7 × 3
  const thinCells = totalCells - meaningfulCells.length;

  // Grid template: 1fr for the left label column, 7 equal columns for days.
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '90px repeat(7, minmax(0, 1fr))',
    gap: '6px',
  };

  return (
    <div className="card">
      <h3 className="section-title">When you post (day × time)</h3>
      <div
        className="text-sm mb-4"
        style={{ color: 'var(--text-secondary)' }}
      >
        <p>
          Both rows show <strong>avg impressions per post</strong> (São Paulo
          local time). Top: aggregated across the whole day. Bottom: same
          days, broken down by time of day. Read each column top-to-bottom:
          the bar tells you the best day overall, the cells tell you when
          within that day to publish. Each day&apos;s bar equals the
          count-weighted average of its three buckets.
        </p>
        <ul className="mt-3 list-disc pl-5 space-y-1">
          {strongestDay.day && (
            <li>
              Best day: <strong>{strongestDay.day}</strong>{' '}
              ({strongestDay.avg.toLocaleString()} avg impressions/post).
            </li>
          )}
          {strongestCell && (
            <li>
              Strongest slot: <strong>{strongestCell.day} · {strongestCell.bucket}</strong>{' '}
              ({strongestCell.avgImpressions.toLocaleString()} avg/post, n=
              {strongestCell.count}).
            </li>
          )}
          <li>
            <strong>Confidence caveat:</strong> only{' '}
            {meaningfulCells.length} of {totalCells} cells have ≥3 posts;
            the other {thinCells} are too thin to read as signal — treat
            anything outside the meaningful cells as noise.
          </li>
        </ul>
      </div>

      {/* Wrap the 8-col grid in a horizontal scroller with a sensible
          min-width so each day's column has room for 4-digit values
          ("9,962"). On narrow viewports the user pans horizontally;
          on desktop everything fits without scroll. -mx-6 + px-6 lets
          the scroll edge bleed to the card border instead of clipping
          inside the card's p-6 padding. */}
      <div className="overflow-x-auto -mx-6 px-6">
      <div className="min-w-[600px]">
      {/* Header row — day labels */}
      <div style={gridStyle} className="mb-2">
        <div />
        {DAY_ORDER.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            {DAY_SHORT[day]}
          </div>
        ))}
      </div>

      {/* Bar row — each day's avg impressions, sized as a vertical bar.
          Colored on the same blue-intensity ramp as the heatmap cells
          below so the eye reads the whole column as one consistent
          gradient. Width = 100% of the column so the bars stack
          flush with the cells underneath. */}
      <div style={gridStyle} className="mb-2 items-end" data-section="bars">
        <div
          className="text-xs flex flex-col items-end justify-end pr-2 pb-1"
          style={{ color: 'var(--text-secondary)' }}
        >
          <div className="font-medium">Per post</div>
          <div
            className="text-[10px] font-normal"
            style={{ color: 'var(--text-muted)' }}
          >
            full day
          </div>
        </div>
        {DAY_ORDER.map((day) => {
          const d = dayByName.get(day);
          const avg = d?.avgImpressions ?? 0;
          const n = d?.count ?? 0;
          const heightPct = maxBar > 0 ? Math.max(2, (avg / maxBar) * 100) : 0;
          // Same blue ramp as the heatmap cells, but normalized against
          // the bar row's own max (so the strongest day always saturates
          // the deepest blue, even if the heatmap's strongest cell is
          // numerically larger).
          const fill = blueFor(avg, n, maxBar);
          // Match the cell's two-line typography so the bar reads as a
          // visual peer of the heatmap rows: value on top in `text-sm`,
          // `n=N` underneath in `text-[10px]` opacity-80. Value sits
          // above the bar (precision matters for the headline), n= sits
          // inside the bar at the bottom (where the cell shows it too).
          return (
            <div
              key={day}
              className="flex flex-col items-stretch justify-end"
              style={{ height: 200 }}
              title={`${day}: ${avg.toLocaleString()} avg impressions/post · n=${n} posts`}
            >
              <span
                className="text-sm font-medium tabular-nums text-center mb-0.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {avg > 0 ? avg.toLocaleString() : '—'}
              </span>
              <div
                style={{
                  width: '100%',
                  height: `${heightPct}%`,
                  backgroundColor: fill,
                  borderRadius: '6px 6px 0 0',
                  transition: 'background 0.2s',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  paddingBottom: '6px',
                }}
              >
                {n > 0 && (
                  <span
                    className="text-[10px] tabular-nums"
                    style={{
                      color: textOnBlue(avg, n, maxBar),
                      opacity: 0.8,
                      fontWeight: 400,
                    }}
                  >
                    n={n}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div
        className="mb-3 mt-1"
        style={{ borderTop: '1px dashed var(--border)' }}
      />

      {/* Heatmap rows — one per bucket */}
      {POSTING_HEATMAP_BUCKETS.map((bucket) => (
        <div key={bucket} style={gridStyle} className="mb-1.5">
          <div
            className="text-xs pr-2 flex flex-col justify-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            <div className="font-medium">{bucket}</div>
            <div
              className="text-[10px] font-normal"
              style={{ color: 'var(--text-muted)' }}
            >
              {BUCKET_HOURS[bucket]}
            </div>
          </div>
          {DAY_ORDER.map((day) => {
            const cell = cellMap.get(`${day}|${bucket}`);
            const count = cell?.count ?? 0;
            const avg = cell?.avgImpressions ?? 0;
            const er = cell?.avgEngagementRate ?? 0;
            const tooltip =
              count === 0
                ? `${day} · ${bucket}: no posts`
                : `${day} · ${bucket}: ${avg.toLocaleString()} avg impressions/post · ${er.toFixed(1)}% ER · n=${count} posts`;
            return (
              <div
                key={`${day}-${bucket}`}
                title={tooltip}
                className="rounded-md py-3 px-2 text-center font-medium tabular-nums transition"
                style={{
                  backgroundColor: cellColor(avg, count),
                  color: cellTextColor(avg, count),
                  minHeight: 60,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                {count === 0 ? (
                  <span className="text-xs opacity-60">—</span>
                ) : (
                  <>
                    <div className="text-sm">
                      {avg >= 1000 ? `${(avg / 1000).toFixed(1)}k` : avg}
                    </div>
                    <div
                      className="text-[10px] opacity-80"
                      style={{ fontWeight: 400 }}
                    >
                      n={count}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
      </div>
      </div>
    </div>
  );
}
