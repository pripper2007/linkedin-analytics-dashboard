// Day-of-week × time-of-day cadence aggregator for engagement events.
// Mirrors src/lib/calculations.ts → calculatePostingHeatmap so the
// activity page reads with the same mental model as the optimization
// page (same buckets: Manhã / Tarde / Noite, same configured timezone —
// see ANALYTICS_TIMEZONE in site-config).
//
// Input: an array of ISO-ish datetime strings ("YYYY-MM-DD HH:MM:SS").
// Output: a 7×3 grid of (day, bucket, count).

import { ANALYTICS_TIMEZONE } from '../site-config';

export type CadenceBucket = 'Manhã' | 'Tarde' | 'Noite';
export const CADENCE_BUCKETS: CadenceBucket[] = ['Manhã', 'Tarde', 'Noite'];

const DAY_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export type CadenceDay = (typeof DAY_ORDER)[number];
export const CADENCE_DAYS: readonly CadenceDay[] = DAY_ORDER;

export interface CadenceCell {
  day: CadenceDay;
  bucket: CadenceBucket;
  count: number;
}

function bucketForHour(h: number): CadenceBucket {
  if (h >= 6 && h < 12) return 'Manhã';
  if (h >= 12 && h < 18) return 'Tarde';
  return 'Noite';
}

function localZonedParts(d: Date): { day: CadenceDay; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIMEZONE,
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const day = (parts.find((p) => p.type === 'weekday')?.value ?? 'Monday') as CadenceDay;
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const h = Number(hourRaw) % 24;
  return { day, hour: Number.isFinite(h) ? h : 0 };
}

export function buildCadence(timestamps: string[]): CadenceCell[] {
  const counts = new Map<string, number>();
  for (const day of DAY_ORDER) {
    for (const bucket of CADENCE_BUCKETS) {
      counts.set(`${day}|${bucket}`, 0);
    }
  }
  for (const ts of timestamps) {
    // Reactions/Comments CSV format: "YYYY-MM-DD HH:MM:SS" (UTC-naive
    // but treated as SP local in our domain, so parse as UTC and let
    // localZonedParts re-bucket per zone).
    const dt = new Date(`${ts.replace(' ', 'T')}Z`);
    if (Number.isNaN(dt.getTime())) continue;
    const { day, hour } = localZonedParts(dt);
    const bucket = bucketForHour(hour);
    const key = `${day}|${bucket}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: CadenceCell[] = [];
  for (const day of DAY_ORDER) {
    for (const bucket of CADENCE_BUCKETS) {
      out.push({ day, bucket, count: counts.get(`${day}|${bucket}`) ?? 0 });
    }
  }
  return out;
}
