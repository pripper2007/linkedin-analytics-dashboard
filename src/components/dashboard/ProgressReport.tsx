'use client';

// Progress Report — cross-period KPI scorecard with a 4-mode toggle.
//
// All four modes are pre-computed on the server (cheap; same data backs
// each), so the toggle is a pure client-side state switch — no extra
// network round-trip and no re-render flicker.
//
// Visual hierarchy per row:
//   metric label │ current │ vs prior (Δ) │ vs year-ago (Δ) │ sparkline
// Δ cells are color-coded: green ↑ for improvement, red ↓ for regression,
// muted "—" when data is missing.

import { useState } from 'react';
import type {
  PeriodMode,
  ProgressReport as ProgressReportData,
  KpiRow,
} from '@/lib/progress-report';

interface Props {
  data: Record<PeriodMode, ProgressReportData>;
  /** Optional default mode. Defaults to MTD which is the "most fresh" view. */
  initialMode?: PeriodMode;
}

const MODE_LABELS: Record<PeriodMode, string> = {
  mtd: 'Month-to-date',
  '30d': 'Last 30 days',
  month: 'Last full month',
  quarter: 'Last quarter',
};

// Abbreviated labels for narrow viewports — full strings would push the
// segmented toggle to ~600px wide, which doesn't fit on a 375px phone.
const MODE_LABELS_SHORT: Record<PeriodMode, string> = {
  mtd: 'MTD',
  '30d': '30d',
  month: 'Month',
  quarter: 'Quarter',
};

const MODES: PeriodMode[] = ['mtd', '30d', 'month', 'quarter'];

function formatNumber(n: number): string {
  // Sign-aware. We use this for both totals (always ≥0) and deltas
  // (can be negative); preserving the minus sign matters for deltas.
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${abs.toLocaleString()}`;
}

function pctChange(current: number | null, ref: number | null): number | null {
  if (current == null || ref == null) return null;
  if (ref === 0) {
    // Going from 0 → anything positive can't be expressed as a percent
    // change cleanly. Show "—" for the % and let the absolute count tell
    // the story.
    return null;
  }
  return ((current - ref) / Math.abs(ref)) * 100;
}

interface DeltaCellProps {
  current: number | null;
  reference: number | null;
  /** Reference period label (e.g. "Apr 2026"). Shown in the cell. */
  refLabel: string;
}

function DeltaCell({ current, reference, refLabel }: DeltaCellProps) {
  if (current == null || reference == null) {
    return (
      <div className="text-right">
        <div style={{ color: 'var(--text-muted)' }}>—</div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          no data
        </div>
      </div>
    );
  }
  const pct = pctChange(current, reference);
  const isUp = current > reference;
  const isFlat = current === reference;
  const color = isFlat ? 'var(--text-muted)' : isUp ? 'var(--success)' : '#dc2626';
  const arrow = isFlat ? '→' : isUp ? '↑' : '↓';

  return (
    <div className="text-right">
      <div className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {formatNumber(reference)}
      </div>
      <div className="text-xs tabular-nums" style={{ color }}>
        {arrow}{' '}
        {pct == null
          ? `${current >= reference ? '+' : ''}${formatNumber(current - reference)}`
          : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
      </div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        vs. {refLabel}
      </div>
    </div>
  );
}

interface SparklineProps {
  series: { date: string; value: number }[];
  /** Reference width in pixels. SVG scales via viewBox; this is just the aspect ratio. */
  width?: number;
  height?: number;
}

function Sparkline({ series, width = 140, height = 32 }: SparklineProps) {
  if (series.length === 0) {
    return (
      <div className="text-right">
        <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
          no data
        </span>
      </div>
    );
  }
  if (series.length === 1) {
    return (
      <div className="text-right">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="ml-auto block">
          <circle cx={width / 2} cy={height / 2} r={2} fill="var(--accent)" />
        </svg>
      </div>
    );
  }
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (series.length - 1);
  // Pad the y-axis slightly so the line doesn't kiss the top/bottom edges.
  const padY = 3;
  const innerH = height - padY * 2;
  const points = series
    .map((p, i) => {
      const x = i * stepX;
      // Invert Y because SVG's origin is top-left.
      const y = padY + innerH - ((p.value - min) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Min/max caption — gives the sparkline a real numeric anchor, so it
  // reads as "daily values ranging from X to Y" rather than an abstract
  // squiggle. Without this, the line shape was decorative not informative.
  return (
    <div className="text-right">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="ml-auto block"
        aria-label={`Daily values from ${formatNumber(min)} to ${formatNumber(max)} across the period`}
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div
        className="text-xs tabular-nums mt-0.5"
        style={{ color: 'var(--text-muted)' }}
      >
        {formatNumber(min)} – {formatNumber(max)}/day
      </div>
    </div>
  );
}

function MetricRow({ row, triple }: { row: KpiRow; triple: ProgressReportData['triple'] }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td className="py-3 px-3" style={{ color: 'var(--text-primary)' }}>
        <div className="font-medium">{row.label}</div>
      </td>
      <td className="py-3 px-3 text-right">
        <div
          className="text-xl font-bold tabular-nums"
          style={{ color: 'var(--text-primary)' }}
        >
          {row.current == null ? '—' : formatNumber(row.current)}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {triple.current.label}
        </div>
      </td>
      <td className="py-3 px-3">
        <DeltaCell current={row.current} reference={row.prior} refLabel={triple.prior.label} />
      </td>
      <td className="py-3 px-3">
        <DeltaCell current={row.current} reference={row.yearAgo} refLabel={triple.yearAgo.label} />
      </td>
      <td className="py-3 px-3 text-right">
        <Sparkline series={row.dailyCurrent} />
      </td>
    </tr>
  );
}

// One card per metric on mobile. Layout:
//   [Metric label]                            [Current value (big)]
//   [period label]
//   ──────────────────────────────────────────────────────────────
//   vs. prior period: [old → new]   [Δ%]
//   vs. year ago:     [old → new]   [Δ%]
//   ──────────────────────────────────────────────────────────────
//   [sparkline + min/max caption]
function MetricCardMobile({
  row,
  triple,
}: {
  row: KpiRow;
  triple: ProgressReportData['triple'];
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: 'var(--border)',
        backgroundColor: 'var(--bg-secondary)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div>
          <div
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {row.label}
          </div>
          <div
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            {triple.current.label}
          </div>
        </div>
        <div
          className="text-2xl font-bold tabular-nums"
          style={{ color: 'var(--text-primary)' }}
        >
          {row.current == null ? '—' : formatNumber(row.current)}
        </div>
      </div>

      <div
        className="border-t pt-2 mt-2 space-y-1.5 text-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        <CompareLine
          label="vs. prior period"
          current={row.current}
          reference={row.prior}
          refLabel={triple.prior.label}
        />
        <CompareLine
          label="vs. year ago"
          current={row.current}
          reference={row.yearAgo}
          refLabel={triple.yearAgo.label}
        />
      </div>

      {row.dailyCurrent.length > 0 && (
        <div
          className="border-t pt-2 mt-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="text-xs uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Trend (daily)
          </div>
          <Sparkline series={row.dailyCurrent} width={300} height={36} />
        </div>
      )}
    </div>
  );
}

// One row inside a MetricCardMobile. Compact: label on the left, ref
// value + delta on the right. Color rules match the desktop DeltaCell.
function CompareLine({
  label,
  current,
  reference,
  refLabel,
}: {
  label: string;
  current: number | null;
  reference: number | null;
  refLabel: string;
}) {
  if (current == null || reference == null) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <div style={{ color: 'var(--text-secondary)' }}>{label}</div>
        <div style={{ color: 'var(--text-muted)' }}>— no data</div>
      </div>
    );
  }
  const pct = pctChange(current, reference);
  const isUp = current > reference;
  const isFlat = current === reference;
  const color = isFlat ? 'var(--text-muted)' : isUp ? 'var(--success)' : '#dc2626';
  const arrow = isFlat ? '→' : isUp ? '↑' : '↓';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div style={{ color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span
          className="block text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          {refLabel}
        </span>
      </div>
      <div className="text-right shrink-0">
        <span
          className="tabular-nums"
          style={{ color: 'var(--text-primary)' }}
        >
          {formatNumber(reference)}
        </span>
        <span className="ml-2 text-xs tabular-nums" style={{ color }}>
          {arrow}{' '}
          {pct == null
            ? `${current >= reference ? '+' : ''}${formatNumber(current - reference)}`
            : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
        </span>
      </div>
    </div>
  );
}

export default function ProgressReport({ data, initialMode = 'mtd' }: Props) {
  const [mode, setMode] = useState<PeriodMode>(initialMode);
  const report = data[mode];

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Progress Report
          </h3>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            How the key KPIs are tracking — sequential momentum (vs. prior
            period) and year-over-year. The <strong>Trend</strong> column is a
            day-by-day mini-line of that metric across the current period: a
            visual sense of whether the headline number came from a steady
            stream or a few spikes. &quot;—&quot; means we don&apos;t have data
            covering that window yet.
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--border)' }}
        >
          {MODES.map((m) => {
            const active = m === mode;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'var(--bg-card)',
                  color: active ? '#ffffff' : 'var(--text-primary)',
                  borderRight:
                    m === MODES[MODES.length - 1]
                      ? 'none'
                      : '1px solid var(--border)',
                }}
              >
                {/* Two labels — the inactive one is hidden via Tailwind's
                    sm: breakpoint (640px). Avoids client-side viewport
                    detection (no hydration mismatch) and works server-side. */}
                <span className="sm:hidden">{MODE_LABELS_SHORT[m]}</span>
                <span className="hidden sm:inline">{MODE_LABELS[m]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: scorecard table — preserves the dense at-a-glance layout
          we tuned for >=md. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          {/* Lock the sparkline column width so the SVG and the "Trend (daily)"
              header line up — without this, browser auto-sizing pushed the
              header far to the right of the actual graph. */}
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col style={{ width: '180px' }} />
          </colgroup>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <th className="text-left py-2 px-3 font-medium">Metric</th>
              <th className="text-right py-2 px-3 font-medium">Current</th>
              <th className="text-right py-2 px-3 font-medium">vs. prior period</th>
              <th className="text-right py-2 px-3 font-medium">vs. year ago</th>
              <th className="text-right py-2 px-3 font-medium">Trend (daily)</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <MetricRow key={row.key} row={row} triple={report.triple} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: same data, stacked vertically. The 5-column table fits
          neither the screen nor a card-stack with side-by-side comparisons,
          so each metric becomes its own card with current at top, the two
          deltas below, and the sparkline at the bottom. */}
      <div className="md:hidden space-y-3">
        {report.rows.map((row) => (
          <MetricCardMobile key={row.key} row={row} triple={report.triple} />
        ))}
      </div>
    </div>
  );
}
