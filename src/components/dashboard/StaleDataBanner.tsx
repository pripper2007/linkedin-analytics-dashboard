// Yellow banner that appears at the top of the dashboard when the
// xlsx-sourced tables (daily_engagement, profile_demographics) are
// older than the staleness threshold. Server component — runs the
// freshness query on every dashboard render. Cheap query (~1ms).

import Link from 'next/link';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

const STALE_THRESHOLD_DAYS = 45;

interface FreshnessSummary {
  daysOld: number;
  lastDate: string;
}

async function getXlsxStaleness(): Promise<FreshnessSummary | null> {
  const r = (await db.execute(sql`
    SELECT
      LEAST(
        (SELECT MAX(date) FROM daily_engagement),
        (SELECT MAX(snapshot_date) FROM profile_demographics)
      )::text AS oldest_xlsx_last
  `)) as unknown as Array<{ oldest_xlsx_last: string | null }>;

  const lastDate = r[0]?.oldest_xlsx_last;
  if (!lastDate) return null;
  const ms = Date.now() - new Date(`${lastDate}T00:00:00Z`).getTime();
  const daysOld = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (daysOld <= STALE_THRESHOLD_DAYS) return null;
  return { daysOld, lastDate };
}

export async function StaleDataBanner() {
  const stale = await getXlsxStaleness();
  if (!stale) return null;

  return (
    <div
      className="rounded-lg border px-4 py-3 flex items-center justify-between gap-4"
      style={{
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderColor: '#f59e0b',
      }}
    >
      <div className="text-sm" style={{ color: '#92400e' }}>
        <span className="font-semibold">Aggregate analytics xlsx is stale.</span>{' '}
        Last data point: <code>{stale.lastDate}</code> ({stale.daysOld} days
        ago). Headline activity charts may be missing recent days.
      </div>
      <Link
        href="/data-health"
        className="shrink-0 px-3 py-1.5 rounded text-sm font-medium text-white transition-colors"
        style={{ backgroundColor: '#d97706' }}
      >
        Refresh →
      </Link>
    </div>
  );
}
