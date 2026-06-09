// Preset + custom date ranges used by the Executive Summary filter.
//
// Design:
// - Everything is UTC-anchored. daily_engagement rows are stored by
//   calendar date (no time component), so we compare using ISO "YYYY-MM-DD"
//   strings rather than Date objects with timezone ambiguity.
// - The "from" is inclusive start-of-day UTC; "to" is inclusive
//   end-of-day UTC. This matches the mental model of "the last 30 days
//   including today".
// - Presets are expressed in days so "last 3 months" is 90 days back —
//   same convention the previous 12-month rollup uses.

export type RangePreset = '7d' | '30d' | '3m' | '6m' | '12m' | 'custom';

export interface DateRange {
  from: Date;         // inclusive, 00:00:00 UTC
  to: Date;           // inclusive, 23:59:59.999 UTC
  fromIso: string;    // "YYYY-MM-DD" — for string comparisons against daily rows
  toIso: string;      // "YYYY-MM-DD"
  preset: RangePreset;
  label: string;      // "Last 30 days" / "Mar 1 – Apr 18, 2026"
  days: number;
}

export const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom…' },
];

const PRESET_DAYS: Record<Exclude<RangePreset, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '3m': 90,
  '6m': 180,
  '12m': 365,
};

function todayUtcEnd(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIsoStart(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

function parseIsoEnd(s: string): Date | null {
  const d = parseIsoStart(s);
  if (!d) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function formatCustomLabel(from: Date, to: Date): string {
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const fmt: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  };
  const fromShort = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(from);
  return sameYear
    ? `${fromShort} – ${new Intl.DateTimeFormat('en-US', fmt).format(to)}`
    : `${new Intl.DateTimeFormat('en-US', fmt).format(from)} – ${new Intl.DateTimeFormat('en-US', fmt).format(to)}`;
}

export const DEFAULT_RANGE: RangePreset = '12m';

// ---------------------------------------------------------------------------
// Bucketing helper — given a resolved DateRange, returns an ordered
// list of buckets that cover [from, to] inclusive. Rule (simple and
// matches what Pedro asked for):
//   - range span ≤ 7 days  → daily buckets
//   - range span > 7 days  → weekly buckets (Mon-start ISO weeks)
// Each bucket's [startIso, endIso] is inclusive on both sides.
// The label is what gets shown on the chart's X axis.
// ---------------------------------------------------------------------------

export type BucketSize = 'daily' | 'weekly';

export interface Bucket {
  key: string;        // "2026-04-18" (daily) or "2026-W16" (weekly, Mon ISO)
  label: string;      // "Apr 18" (daily) or "Apr 15" (week-start Mon)
  startIso: string;   // inclusive — "YYYY-MM-DD"
  endIso: string;     // inclusive — "YYYY-MM-DD"
}

export interface Bucketing {
  size: BucketSize;
  buckets: Bucket[];
}

function addDaysUtc(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Mon-start week: for any UTC date, rewind to Monday 00:00:00 UTC.
function mondayOfWeek(d: Date): Date {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay(): 0 = Sun, 1 = Mon, ... 6 = Sat. We want Mon.
  const dow = m.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDaysUtc(m, offset);
}

// ISO week string "YYYY-Www" — week-year and week-number per ISO 8601.
function isoWeekKey(d: Date): string {
  // Copy so we don't mutate input, then shift to Thursday of that week
  // (ISO 8601 defines the week based on the Thursday).
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(weekNo).padStart(2, '0')}`;
}

export function bucketsForRange(range: DateRange): Bucketing {
  const size: BucketSize = range.days <= 7 ? 'daily' : 'weekly';
  const buckets: Bucket[] = [];

  if (size === 'daily') {
    let cursor = new Date(range.from);
    while (cursor <= range.to) {
      const iso = isoDate(cursor);
      buckets.push({
        key: iso,
        label: new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(cursor),
        startIso: iso,
        endIso: iso,
      });
      cursor = addDaysUtc(cursor, 1);
    }
    return { size, buckets };
  }

  // Weekly: first bucket starts at the Monday on/before `from`, last
  // bucket ends at the Sunday on/after `to`. We clip bucket
  // [startIso, endIso] so series aggregation only counts days inside
  // the selected window — otherwise the first/last partial weeks would
  // double-count days outside the range.
  let weekStart = mondayOfWeek(range.from);
  while (weekStart <= range.to) {
    const weekEnd = addDaysUtc(weekStart, 6);
    const clippedStart = weekStart < range.from ? range.from : weekStart;
    const clippedEnd = weekEnd > range.to ? range.to : weekEnd;
    buckets.push({
      key: isoWeekKey(weekStart),
      label: new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(weekStart),
      startIso: isoDate(clippedStart),
      endIso: isoDate(clippedEnd),
    });
    weekStart = addDaysUtc(weekStart, 7);
  }
  return { size, buckets };
}

export function resolveRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): DateRange {
  const to = todayUtcEnd();

  // Custom range — both endpoints must parse. If either fails we fall
  // through to the default preset rather than erroring on the user.
  if (params.range === 'custom' && params.from && params.to) {
    const cFrom = parseIsoStart(params.from);
    const cTo = parseIsoEnd(params.to);
    if (cFrom && cTo) {
      // Swap if the user inverted them — friendlier than an error.
      const [lo, hi] = cFrom <= cTo ? [cFrom, cTo] : [cTo, cFrom];
      return {
        from: lo,
        to: hi,
        fromIso: toIsoDate(lo),
        toIso: toIsoDate(hi),
        preset: 'custom',
        label: formatCustomLabel(lo, hi),
        days: Math.max(
          1,
          Math.round((hi.getTime() - lo.getTime()) / 86_400_000) + 1,
        ),
      };
    }
  }

  const preset = (['7d', '30d', '3m', '6m', '12m'] as RangePreset[]).includes(
    params.range as RangePreset,
  )
    ? (params.range as Exclude<RangePreset, 'custom'>)
    : DEFAULT_RANGE;

  const days = PRESET_DAYS[preset as Exclude<RangePreset, 'custom'>];
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days + 1);
  from.setUTCHours(0, 0, 0, 0);

  return {
    from,
    to,
    fromIso: toIsoDate(from),
    toIso: toIsoDate(to),
    preset,
    label: RANGE_OPTIONS.find((o) => o.value === preset)!.label,
    days,
  };
}
