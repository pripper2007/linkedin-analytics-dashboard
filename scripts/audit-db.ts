// Data-integrity audit. Reports problems without fixing them — fix is
// a separate step once the user sees what's actually broken.

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

interface Row {
  [k: string]: unknown;
}

async function q(label: string, stmt: ReturnType<typeof sql>): Promise<void> {
  const rows = (await db.execute(stmt)) as unknown as Row[];
  console.log(`\n### ${label}`);
  if (rows.length === 0) {
    console.log('  OK (0 rows)');
    return;
  }
  for (const r of rows.slice(0, 10)) console.log('  ', JSON.stringify(r));
  if (rows.length > 10) console.log(`  ... (+${rows.length - 10} more)`);
}

async function main() {
  // Duplicate posts (same minute, different activity_id — expected for
  // CSV share-URN vs extension activity-URN overlap).
  await q(
    'Posts at the same minute with different activity_ids',
    sql`
      SELECT date_trunc('minute', posted_at) AS minute,
             ARRAY_AGG(activity_id) AS ids,
             COUNT(*)::int AS n
      FROM posts
      GROUP BY date_trunc('minute', posted_at)
      HAVING COUNT(*) > 1
      ORDER BY minute DESC
    `,
  );

  // Posts with empty or whitespace-only content.
  await q(
    'Posts with empty post_content',
    sql`SELECT activity_id, posted_at FROM posts WHERE TRIM(post_content) = '' ORDER BY posted_at DESC LIMIT 20`,
  );

  // Posts with future postedAt (timezone bugs).
  await q(
    'Posts with postedAt in the future',
    sql`SELECT activity_id, posted_at FROM posts WHERE posted_at > now() ORDER BY posted_at DESC`,
  );

  // Post_snapshots referencing non-existent posts (FK would prevent, but check).
  await q(
    'Orphaned post_snapshots',
    sql`
      SELECT ps.activity_id, ps.snapshot_date
      FROM post_snapshots ps
      LEFT JOIN posts p ON p.activity_id = ps.activity_id
      WHERE p.activity_id IS NULL
    `,
  );

  // Profile_snapshots with conflicting totals (same date, different values).
  // Shouldn't happen — unique index on snapshot_date — but verify.
  await q(
    'Profile_snapshots rows per date',
    sql`
      SELECT snapshot_date, COUNT(*)::int AS n
      FROM profile_snapshots
      GROUP BY snapshot_date
      HAVING COUNT(*) > 1
    `,
  );

  // Profile_snapshots with zero or negative follower counts.
  await q(
    'Profile_snapshots with non-positive total_followers',
    sql`SELECT snapshot_date, total_followers FROM profile_snapshots WHERE total_followers IS NOT NULL AND total_followers <= 0`,
  );

  // Profile_snapshots gaps (missing dates between start and end).
  await q(
    'Profile_snapshot date gaps (first 10)',
    sql`
      WITH dates AS (
        SELECT snapshot_date,
               LAG(snapshot_date) OVER (ORDER BY snapshot_date) AS prev
        FROM profile_snapshots
      )
      SELECT snapshot_date, prev, (snapshot_date - prev) AS gap_days
      FROM dates
      WHERE prev IS NOT NULL AND (snapshot_date - prev) > 1
      ORDER BY snapshot_date
    `,
  );

  // Daily_engagement missing dates in the covered range.
  await q(
    'Daily_engagement date gaps',
    sql`
      WITH dates AS (
        SELECT date, LAG(date) OVER (ORDER BY date) AS prev FROM daily_engagement
      )
      SELECT date, prev, (date - prev) AS gap_days
      FROM dates
      WHERE prev IS NOT NULL AND (date - prev) > 1
      ORDER BY date
    `,
  );

  // Posts with zero impressions in post_snapshots (could be brand-new posts
  // or failed captures). Report count only.
  await q(
    'Posts whose latest snapshot has 0 impressions (count)',
    sql`
      SELECT COUNT(*)::int AS n
      FROM posts p
      LEFT JOIN LATERAL (
        SELECT impressions FROM post_snapshots
        WHERE activity_id = p.activity_id
        ORDER BY snapshot_date DESC LIMIT 1
      ) s ON true
      WHERE COALESCE(s.impressions, 0) = 0
    `,
  );

  // Posts with NO snapshot at all (never captured metrics).
  await q(
    'Posts with ZERO snapshots in post_snapshots (count)',
    sql`
      SELECT COUNT(*)::int AS n
      FROM posts p
      WHERE NOT EXISTS (
        SELECT 1 FROM post_snapshots WHERE activity_id = p.activity_id
      )
    `,
  );

  // Posts with impossible engagement_rate (> 100% in latest snapshot).
  await q(
    'Post_snapshots with engagement_rate > 100',
    sql`
      SELECT activity_id, snapshot_date, engagement_rate
      FROM post_snapshots
      WHERE engagement_rate IS NOT NULL AND engagement_rate > 100
      ORDER BY snapshot_date DESC
    `,
  );

  // post_demographics pct values out of [0, 100] range.
  await q(
    'Post_demographics pct out of range',
    sql`SELECT activity_id, snapshot_date, category, value, pct FROM post_demographics WHERE pct < 0 OR pct > 100`,
  );

  // profile_demographics pct out of range.
  await q(
    'Profile_demographics pct out of range',
    sql`SELECT snapshot_date, category, value, pct FROM profile_demographics WHERE pct < 0 OR pct > 100`,
  );

  // Summary counts
  await q(
    'SUMMARY',
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM posts)                   AS posts,
        (SELECT COUNT(*)::int FROM post_snapshots)          AS post_snapshots,
        (SELECT COUNT(*)::int FROM post_demographics)       AS post_demographics,
        (SELECT COUNT(*)::int FROM profile_snapshots)       AS profile_snapshots,
        (SELECT COUNT(*)::int FROM profile_demographics)    AS profile_demographics,
        (SELECT COUNT(*)::int FROM daily_engagement)        AS daily_engagement,
        (SELECT COUNT(*)::int FROM ingest_log)              AS ingest_log
    `,
  );
}

main().then(() => process.exit(0));
