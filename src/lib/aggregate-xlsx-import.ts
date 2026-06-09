// Importer for LinkedIn's "AggregateAnalytics_<name>_<start>_<end>.xlsx"
// Creator-mode export. Reads three of the workbook's sheets and writes
// them into the corresponding tables. Shared between the historical
// backfill script (scripts/backfill-historical.ts) and the upload API
// route (src/app/api/import-aggregate-xlsx) so both paths converge on
// the exact same behaviour.

import * as XLSX from 'xlsx';
import { db } from '@/db/client';
import {
  upsertDailyEngagement,
  upsertProfileSnapshot,
  upsertProfileDemographic,
} from '@/db/upserts';
import { parsePct } from '../../scripts/seed-transforms';

/** "3/15/2025" → "2025-03-15" (the DATE-column format used by LinkedIn). */
function parseUsDate(raw: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) throw new Error(`unparseable US date: ${raw}`);
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
function dayOfWeek(isoDate: string): string {
  return DAY_NAMES[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

function loadSheet(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`sheet not found: ${name}`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
  });
}

// ---------------------------------------------------------------------------
// 1. ENGAGEMENT → daily_engagement
// ---------------------------------------------------------------------------
export async function importEngagement(wb: XLSX.WorkBook): Promise<number> {
  const rows = loadSheet(wb, 'ENGAGEMENT');
  let inserted = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as [string, string, string];
    if (!r || !r[0]) continue;
    const isoDate = parseUsDate(r[0]);
    const impressions = Number(r[1] ?? 0);
    const engagements = Number(r[2] ?? 0);
    if (!Number.isFinite(impressions) || !Number.isFinite(engagements)) continue;
    await upsertDailyEngagement(db, {
      date: isoDate,
      impressions,
      engagements,
      dayOfWeek: dayOfWeek(isoDate),
    });
    inserted++;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// 2. FOLLOWERS → profile_snapshots
//
// Sheet shape:
//   Row 0: ["Total followers on 4/18/2026", "10229"]
//   Row 1: ["", ""]
//   Row 2: ["Date", "New followers"]
//   Row 3+: [date, newFollowers]
//
// Anchor = total at end-date. Walk backward to derive the running total
// per earlier date. upsertProfileSnapshot COALESCEs nulls so we don't
// clobber any connection counts the extension has written.
// ---------------------------------------------------------------------------
export async function importFollowers(wb: XLSX.WorkBook): Promise<{
  inserted: number;
  anchorDate: string;
  anchorTotal: number;
}> {
  const rows = loadSheet(wb, 'FOLLOWERS');

  const anchorCell = String(rows[0]?.[0] ?? '');
  const anchorMatch = /Total followers on (\d+\/\d+\/\d+)/.exec(anchorCell);
  if (!anchorMatch) throw new Error(`can't parse anchor cell: "${anchorCell}"`);
  const anchorDate = parseUsDate(anchorMatch[1]);
  const anchorTotal = Number(rows[0]?.[1] ?? 0);
  if (!Number.isFinite(anchorTotal)) {
    throw new Error(`anchor total not a number: ${rows[0]?.[1]}`);
  }

  const daily: Array<{ date: string; newFollowers: number }> = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] as [string, string];
    if (!r || !r[0]) continue;
    daily.push({
      date: parseUsDate(r[0]),
      newFollowers: Number(r[1] ?? 0),
    });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  let runningTotal = anchorTotal;
  const perDate: Array<{ date: string; total: number }> = [];
  for (let i = daily.length - 1; i >= 0; i--) {
    perDate.unshift({ date: daily[i].date, total: runningTotal });
    runningTotal -= daily[i].newFollowers;
  }
  const hasAnchor = perDate.some((p) => p.date === anchorDate);
  if (!hasAnchor) perDate.push({ date: anchorDate, total: anchorTotal });

  let inserted = 0;
  for (const { date, total } of perDate) {
    await upsertProfileSnapshot(db, {
      snapshotDate: date,
      totalFollowers: total,
      totalConnections: null,
      followerGrowth12mo: null,
      totalImpressions12mo: null,
      totalEngagements12mo: null,
    });
    inserted++;
  }
  return { inserted, anchorDate, anchorTotal };
}

// ---------------------------------------------------------------------------
// 3. DEMOGRAPHICS → profile_demographics
// ---------------------------------------------------------------------------
export async function importDemographics(
  wb: XLSX.WorkBook,
  snapshotDate: string,
): Promise<number> {
  const rows = loadSheet(wb, 'DEMOGRAPHICS');
  let inserted = 0;
  const rankByCategory = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as [string, string, string];
    if (!r || !r[0]) continue;
    const category = String(r[0]).trim();
    const value = String(r[1]).trim();
    const pct = parsePct(String(r[2]));
    if (!category || !value) continue;
    const rank = (rankByCategory.get(category) ?? 0) + 1;
    rankByCategory.set(category, rank);
    await upsertProfileDemographic(db, {
      snapshotDate,
      category,
      value,
      pct: String(pct) as unknown as string,
      rank,
    });
    inserted++;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Convenience wrapper: runs all three imports against the same workbook
// and returns a summary. The API route uses this directly.
// ---------------------------------------------------------------------------
export interface AggregateImportSummary {
  engagementRows: number;
  followerRows: number;
  followerAnchorDate: string;
  followerAnchorTotal: number;
  demographicRows: number;
}

export async function importAggregateXlsx(
  buffer: ArrayBuffer | Buffer,
): Promise<AggregateImportSummary> {
  const wb = XLSX.read(buffer, { type: 'buffer' });

  const engagementRows = await importEngagement(wb);
  const { inserted: followerRows, anchorDate, anchorTotal } =
    await importFollowers(wb);
  const demographicRows = await importDemographics(wb, anchorDate);

  return {
    engagementRows,
    followerRows,
    followerAnchorDate: anchorDate,
    followerAnchorTotal: anchorTotal,
    demographicRows,
  };
}
