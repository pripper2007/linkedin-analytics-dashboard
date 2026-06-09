'use client';

// Day-of-week × time-of-day heatmap for the activity page. Same visual
// language as the bottom of the optimization page's "When you post"
// chart so the two pages read consistently — but rendered standalone
// (no bar row above) since here we're just showing one metric: count
// of engagement events in each day/bucket.

import {
  CADENCE_BUCKETS,
  CADENCE_DAYS,
  type CadenceCell,
} from '@/lib/activity/cadence';

interface Props {
  cells: CadenceCell[];
}

const DAY_SHORT: Record<(typeof CADENCE_DAYS)[number], string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

const BUCKET_HOURS: Record<(typeof CADENCE_BUCKETS)[number], string> = {
  'Manhã': '06–12h',
  'Tarde': '12–18h',
  'Noite': '18–06h',
};

export default function EngagementCadenceHeatmap({ cells }: Props) {
  const max = cells.reduce((m, c) => (c.count > m ? c.count : m), 0);
  const cellMap = new Map<string, CadenceCell>();
  for (const c of cells) cellMap.set(`${c.day}|${c.bucket}`, c);

  const blueFor = (count: number): string => {
    if (count === 0 || max <= 0) return 'var(--bg-secondary)';
    const t = Math.min(1, count / max);
    const lightness = 95 - 60 * t;
    return `hsl(217, 91%, ${lightness}%)`;
  };

  const textOnBlue = (count: number): string => {
    if (count === 0) return 'var(--text-muted)';
    const t = Math.min(1, count / Math.max(max, 1));
    return t > 0.55 ? '#ffffff' : 'var(--text-primary)';
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '90px repeat(7, minmax(0, 1fr))',
    gap: '6px',
  };

  return (
    <div className="card">
      <h3 className="section-title">When you engage (day × time)</h3>
      <p
        className="text-sm mb-4"
        style={{ color: 'var(--text-secondary)' }}
      >
        Reactions and comments you gave on others&apos; posts, bucketed by
        São Paulo local time of day. Strong cells = your habit windows.
      </p>

      {/* Header row — day labels */}
      <div style={gridStyle} className="mb-2">
        <div />
        {CADENCE_DAYS.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            {DAY_SHORT[day]}
          </div>
        ))}
      </div>

      {/* Heatmap rows */}
      {CADENCE_BUCKETS.map((bucket) => (
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
          {CADENCE_DAYS.map((day) => {
            const cell = cellMap.get(`${day}|${bucket}`);
            const count = cell?.count ?? 0;
            const tooltip =
              count === 0
                ? `${day} · ${bucket}: no events`
                : `${day} · ${bucket}: ${count.toLocaleString()} reactions+comments`;
            return (
              <div
                key={`${day}-${bucket}`}
                title={tooltip}
                className="rounded-md py-3 px-2 text-center font-medium tabular-nums"
                style={{
                  backgroundColor: blueFor(count),
                  color: textOnBlue(count),
                  minHeight: 60,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                {count === 0 ? (
                  <span className="text-xs opacity-60">—</span>
                ) : (
                  <div className="text-sm">
                    {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
