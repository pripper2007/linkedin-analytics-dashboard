// Progress Report — cross-period KPI comparison for the dashboard.
//
// Surfaces 4 KPIs (posts, impressions, engagements, new followers) across
// 4 time-window modes (MTD, last 30 days, last full month, last quarter)
// with two comparison axes per KPI:
//
//   • vs. prior — the immediately preceding equivalent window (sequential
//     momentum, e.g. MoM/QoQ).
//   • vs. year-ago — the same window one year earlier (seasonal-controlled
//     growth, i.e. YoY).
//
// All "from" dates are inclusive; all "to" dates are inclusive; everything
// is computed in UTC and YYYY-MM-DD strings to match the daily_engagement
// and profile_snapshots tables (both indexed by an ISO date column).

import type { Post, DailyEntry } from './types';
import type { FollowerHistoryPoint } from './queries';

export type PeriodMode = 'mtd' | '30d' | 'month' | 'quarter';

export interface PeriodWindow {
  fromIso: string;
  toIso: string;
  label: string;
}

export interface PeriodTriple {
  mode: PeriodMode;
  current: PeriodWindow;
  prior: PeriodWindow;
  yearAgo: PeriodWindow;
}

export type KpiKey = 'posts' | 'impressions' | 'engagements' | 'newFollowers';

export interface DailyPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

export interface KpiRow {
  key: KpiKey;
  label: string;
  /** null = no data for this window (vs. 0 = "we have data, the answer is zero"). */
  current: number | null;
  prior: number | null;
  yearAgo: number | null;
  /** Daily series across the CURRENT window — for the sparkline. */
  dailyCurrent: DailyPoint[];
}

export interface ProgressReport {
  triple: PeriodTriple;
  rows: KpiRow[];
}

// ---------------------------------------------------------------------------
// Date helpers — all UTC. Working in UTC keeps day boundaries deterministic
// across timezone changes (e.g. when Brasilia switches DST) and matches
// how daily_engagement / profile_snapshots store their dates.
// ---------------------------------------------------------------------------

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function addDaysUtc(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
function daysInMonthUtc(year: number, monthZero: number): number {
  return new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
}
/** Clamp a target day-of-month to whatever the target month has (e.g. Jan 31 → Feb 28). */
function clampDay(year: number, monthZero: number, day: number): number {
  return Math.min(day, daysInMonthUtc(year, monthZero));
}
function startOfQuarterUtc(d: Date): Date {
  const qStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), qStartMonth, 1));
}
function endOfQuarterUtc(d: Date): Date {
  const qEndMonth = Math.floor(d.getUTCMonth() / 3) * 3 + 2;
  return new Date(Date.UTC(d.getUTCFullYear(), qEndMonth + 1, 0));
}

// ---------------------------------------------------------------------------
// Window builders — given today (UTC), produce { current, prior, yearAgo }
// triples for each mode. Labels are short, human-readable strings used in
// the UI's table headers and sparkline tooltips.
// ---------------------------------------------------------------------------

function mtdWindows(today: Date): PeriodTriple {
  const day = today.getUTCDate();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  const current: PeriodWindow = {
    fromIso: toIso(new Date(Date.UTC(year, month, 1))),
    toIso: toIso(today),
    label: `${monthName(month)} 1–${day}, ${year}`,
  };

  // Prior month MTD — clip the day to whatever the prior month has, so
  // a May-31 view doesn't try to look at "Apr 31" (clipped to Apr 30).
  const priorMonth = month === 0 ? 11 : month - 1;
  const priorYear = month === 0 ? year - 1 : year;
  const priorDay = clampDay(priorYear, priorMonth, day);
  const prior: PeriodWindow = {
    fromIso: toIso(new Date(Date.UTC(priorYear, priorMonth, 1))),
    toIso: toIso(new Date(Date.UTC(priorYear, priorMonth, priorDay))),
    label: `${monthName(priorMonth)} 1–${priorDay}, ${priorYear}`,
  };

  // Year-ago MTD — same idea but back one year.
  const yaDay = clampDay(year - 1, month, day);
  const yearAgo: PeriodWindow = {
    fromIso: toIso(new Date(Date.UTC(year - 1, month, 1))),
    toIso: toIso(new Date(Date.UTC(year - 1, month, yaDay))),
    label: `${monthName(month)} 1–${yaDay}, ${year - 1}`,
  };

  return { mode: 'mtd', current, prior, yearAgo };
}

function rolling30Windows(today: Date): PeriodTriple {
  // Trailing 30 days, inclusive of today (so 30 distinct days total).
  const currentEnd = today;
  const currentStart = addDaysUtc(today, -29);
  const priorEnd = addDaysUtc(currentStart, -1);
  const priorStart = addDaysUtc(priorEnd, -29);
  const yaEnd = addDaysUtc(today, -365);
  const yaStart = addDaysUtc(yaEnd, -29);
  return {
    mode: '30d',
    current: { fromIso: toIso(currentStart), toIso: toIso(currentEnd), label: 'Last 30 days' },
    prior:   { fromIso: toIso(priorStart),   toIso: toIso(priorEnd),   label: 'Prior 30 days' },
    yearAgo: { fromIso: toIso(yaStart),      toIso: toIso(yaEnd),      label: 'Same 30 days, last year' },
  };
}

function lastFullMonthWindows(today: Date): PeriodTriple {
  // The most recently COMPLETED calendar month — exclude the in-progress
  // current month so the comparison is apples-to-apples against full months.
  const thisMonthStart = startOfMonthUtc(today);
  const lastMonthEnd = addDaysUtc(thisMonthStart, -1);
  const lastMonthStart = startOfMonthUtc(lastMonthEnd);
  const monthBeforeEnd = addDaysUtc(lastMonthStart, -1);
  const monthBeforeStart = startOfMonthUtc(monthBeforeEnd);

  // Year-ago = same calendar month, prior year (handle Feb-29 by clamping).
  const yaYear = lastMonthStart.getUTCFullYear() - 1;
  const yaMonth = lastMonthStart.getUTCMonth();
  const yaStart = new Date(Date.UTC(yaYear, yaMonth, 1));
  const yaEnd = endOfMonthUtc(yaStart);

  return {
    mode: 'month',
    current: {
      fromIso: toIso(lastMonthStart),
      toIso: toIso(lastMonthEnd),
      label: `${monthName(lastMonthStart.getUTCMonth())} ${lastMonthStart.getUTCFullYear()}`,
    },
    prior: {
      fromIso: toIso(monthBeforeStart),
      toIso: toIso(monthBeforeEnd),
      label: `${monthName(monthBeforeStart.getUTCMonth())} ${monthBeforeStart.getUTCFullYear()}`,
    },
    yearAgo: {
      fromIso: toIso(yaStart),
      toIso: toIso(yaEnd),
      label: `${monthName(yaMonth)} ${yaYear}`,
    },
  };
}

function lastQuarterWindows(today: Date): PeriodTriple {
  // Last COMPLETED calendar quarter. If today is in Q2, last completed = Q1.
  const thisQuarterStart = startOfQuarterUtc(today);
  const lastQuarterEnd = addDaysUtc(thisQuarterStart, -1);
  const lastQuarterStart = startOfQuarterUtc(lastQuarterEnd);
  const quarterBeforeEnd = addDaysUtc(lastQuarterStart, -1);
  const quarterBeforeStart = startOfQuarterUtc(quarterBeforeEnd);
  const yaStart = new Date(
    Date.UTC(
      lastQuarterStart.getUTCFullYear() - 1,
      lastQuarterStart.getUTCMonth(),
      1,
    ),
  );
  const yaEnd = endOfQuarterUtc(yaStart);

  return {
    mode: 'quarter',
    current: {
      fromIso: toIso(lastQuarterStart),
      toIso: toIso(lastQuarterEnd),
      label: quarterLabel(lastQuarterStart),
    },
    prior: {
      fromIso: toIso(quarterBeforeStart),
      toIso: toIso(quarterBeforeEnd),
      label: quarterLabel(quarterBeforeStart),
    },
    yearAgo: {
      fromIso: toIso(yaStart),
      toIso: toIso(yaEnd),
      label: quarterLabel(yaStart),
    },
  };
}

export function computeWindows(mode: PeriodMode, today: Date): PeriodTriple {
  switch (mode) {
    case 'mtd':     return mtdWindows(today);
    case '30d':     return rolling30Windows(today);
    case 'month':   return lastFullMonthWindows(today);
    case 'quarter': return lastQuarterWindows(today);
  }
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthName(zeroBased: number): string { return MONTHS_SHORT[zeroBased] ?? '???'; }
function quarterLabel(d: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// KPI computation — for a given window, pull totals + a daily series from
// the source tables. All four sources expose YYYY-MM-DD date columns, so
// string comparison is sufficient (no Date parsing per row).
// ---------------------------------------------------------------------------

function inWindowIso(iso: string, w: PeriodWindow): boolean {
  return iso >= w.fromIso && iso <= w.toIso;
}

function postDateIso(p: Post): string | null {
  // post_date arrives from the legacy adapter as "M/D/YYYY". Parse it
  // through Date so we get a normalized YYYY-MM-DD; fall back to null
  // if it's malformed (shouldn't happen but the data layer is loose).
  const d = new Date(p.post_date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function countPostsInWindow(posts: Post[], w: PeriodWindow): number {
  let n = 0;
  for (const p of posts) {
    const iso = postDateIso(p);
    if (iso && inWindowIso(iso, w)) n++;
  }
  return n;
}

function postsDailySeries(posts: Post[], w: PeriodWindow): DailyPoint[] {
  const map = new Map<string, number>();
  for (const p of posts) {
    const iso = postDateIso(p);
    if (iso && inWindowIso(iso, w)) map.set(iso, (map.get(iso) ?? 0) + 1);
  }
  return fillDailySeries(w, map);
}

/** True iff any daily_engagement row is on/before the window's start. */
function dailyEngagementCovers(daily: DailyEntry[], w: PeriodWindow): boolean {
  if (daily.length === 0) return false;
  // daily is not guaranteed sorted, but in practice queries.ts returns ASC.
  // We just need to know whether the table predates the window — if the
  // EARLIEST row is later than fromIso, we have no coverage at all.
  let earliest = daily[0].date;
  for (const d of daily) if (d.date < earliest) earliest = d.date;
  return earliest <= w.fromIso;
}

interface SumPair { impressions: number; engagements: number; }

function sumDailyEngagement(daily: DailyEntry[], w: PeriodWindow): SumPair {
  let impressions = 0;
  let engagements = 0;
  for (const d of daily) {
    if (inWindowIso(d.date, w)) {
      impressions += d.impressions;
      engagements += d.engagements;
    }
  }
  return { impressions, engagements };
}

function dailyImpressionsSeries(daily: DailyEntry[], w: PeriodWindow): DailyPoint[] {
  const map = new Map<string, number>();
  for (const d of daily) if (inWindowIso(d.date, w)) map.set(d.date, d.impressions);
  return fillDailySeries(w, map);
}

function dailyEngagementsSeries(daily: DailyEntry[], w: PeriodWindow): DailyPoint[] {
  const map = new Map<string, number>();
  for (const d of daily) if (inWindowIso(d.date, w)) map.set(d.date, d.engagements);
  return fillDailySeries(w, map);
}

/**
 * New followers across a window = total_followers(toIso) − total_followers(fromIso − 1d).
 * Both anchors must exist in profile_snapshots; otherwise return null so
 * the UI can render "—" instead of a misleading 0.
 */
function newFollowers(history: FollowerHistoryPoint[], w: PeriodWindow): number | null {
  const before = lastReadingOnOrBefore(history, addOneDayBack(w.fromIso));
  const end = lastReadingOnOrBefore(history, w.toIso);
  if (before == null || end == null) return null;
  return end - before;
}

function dailyFollowerDeltaSeries(history: FollowerHistoryPoint[], w: PeriodWindow): DailyPoint[] {
  // For each day in the window, the day's net follower change is the
  // diff between that day's reading and the previous day's reading.
  // Days with no reading inherit the last known value (so the series is
  // 0 on a "no-reading" day, not a discontinuity).
  const map = new Map<string, number>();
  let prev = lastReadingOnOrBefore(history, addOneDayBack(w.fromIso));
  let cursor = fromIso(w.fromIso);
  const end = fromIso(w.toIso);
  while (cursor <= end) {
    const iso = toIso(cursor);
    const today = lastReadingOnOrBefore(history, iso);
    if (today != null && prev != null) {
      map.set(iso, today - prev);
    } else if (today != null) {
      map.set(iso, 0);
    }
    if (today != null) prev = today;
    cursor = addDaysUtc(cursor, 1);
  }
  return fillDailySeries(w, map);
}

function lastReadingOnOrBefore(history: FollowerHistoryPoint[], iso: string): number | null {
  // history is asc-sorted (queries.ts ORDER BY snapshot_date ASC). Walk
  // forward; remember the last value <= iso.
  let last: number | null = null;
  for (const p of history) {
    if (p.date <= iso) last = p.total_followers;
    else break;
  }
  return last;
}

function addOneDayBack(iso: string): string {
  return toIso(addDaysUtc(fromIso(iso), -1));
}

/** Fill in 0 for any day in the window not present in `map`. Stable order. */
function fillDailySeries(w: PeriodWindow, map: Map<string, number>): DailyPoint[] {
  const out: DailyPoint[] = [];
  let cursor = fromIso(w.fromIso);
  const end = fromIso(w.toIso);
  while (cursor <= end) {
    const iso = toIso(cursor);
    out.push({ date: iso, value: map.get(iso) ?? 0 });
    cursor = addDaysUtc(cursor, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function buildProgressReport(
  posts: Post[],
  daily: DailyEntry[],
  followerHistory: FollowerHistoryPoint[],
  mode: PeriodMode,
  today: Date = new Date(),
): ProgressReport {
  const triple = computeWindows(mode, today);

  // Respect data-coverage limits. daily_engagement and profile_snapshots
  // both started 2025-03-15. If a comparison window predates the source's
  // earliest row, the metric for that window is null (UI shows "—").
  const dailyCovers = (w: PeriodWindow) => dailyEngagementCovers(daily, w);
  const followersCover = (w: PeriodWindow) =>
    followerHistory.length > 0 &&
    followerHistory[0].date <= addOneDayBack(w.fromIso);

  const rows: KpiRow[] = [
    {
      key: 'posts',
      label: 'Posts',
      current: countPostsInWindow(posts, triple.current),
      prior: countPostsInWindow(posts, triple.prior),
      yearAgo: countPostsInWindow(posts, triple.yearAgo),
      dailyCurrent: postsDailySeries(posts, triple.current),
    },
    {
      key: 'impressions',
      label: 'Impressions',
      current: dailyCovers(triple.current) ? sumDailyEngagement(daily, triple.current).impressions : null,
      prior:   dailyCovers(triple.prior)   ? sumDailyEngagement(daily, triple.prior).impressions   : null,
      yearAgo: dailyCovers(triple.yearAgo) ? sumDailyEngagement(daily, triple.yearAgo).impressions : null,
      dailyCurrent: dailyCovers(triple.current)
        ? dailyImpressionsSeries(daily, triple.current)
        : [],
    },
    {
      key: 'engagements',
      label: 'Engagements',
      current: dailyCovers(triple.current) ? sumDailyEngagement(daily, triple.current).engagements : null,
      prior:   dailyCovers(triple.prior)   ? sumDailyEngagement(daily, triple.prior).engagements   : null,
      yearAgo: dailyCovers(triple.yearAgo) ? sumDailyEngagement(daily, triple.yearAgo).engagements : null,
      dailyCurrent: dailyCovers(triple.current)
        ? dailyEngagementsSeries(daily, triple.current)
        : [],
    },
    {
      key: 'newFollowers',
      label: 'New Followers',
      current: followersCover(triple.current) ? newFollowers(followerHistory, triple.current) : null,
      prior:   followersCover(triple.prior)   ? newFollowers(followerHistory, triple.prior)   : null,
      yearAgo: followersCover(triple.yearAgo) ? newFollowers(followerHistory, triple.yearAgo) : null,
      dailyCurrent: followersCover(triple.current)
        ? dailyFollowerDeltaSeries(followerHistory, triple.current)
        : [],
    },
  ];

  return { triple, rows };
}

/** Build a report for every mode (used to pre-compute on the server). */
export function buildAllModes(
  posts: Post[],
  daily: DailyEntry[],
  followerHistory: FollowerHistoryPoint[],
  today: Date = new Date(),
): Record<PeriodMode, ProgressReport> {
  return {
    mtd:     buildProgressReport(posts, daily, followerHistory, 'mtd', today),
    '30d':   buildProgressReport(posts, daily, followerHistory, '30d', today),
    month:   buildProgressReport(posts, daily, followerHistory, 'month', today),
    quarter: buildProgressReport(posts, daily, followerHistory, 'quarter', today),
  };
}
