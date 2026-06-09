// Single comprehensive refill: every in-window post (≤24mo, activity URN)
// that doesn't have full demographics today gets its today-snapshot
// deleted so the backfill re-captures it with the new JSON-aware
// detail-page parser.
//
// Preserves:
//   - posts with ≥25 demographic rows today (already complete)
//   - posts >360 days old (LinkedIn won't serve demographics)
//   - all earlier-dated snapshots (only today's row is removed)
//
// Usage:
//   npx tsx --env-file=.env.local scripts/refill-all-stale-demographics.ts
//   npx tsx --env-file=.env.local scripts/refill-all-stale-demographics.ts --apply

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'APPLY (will delete rows)' : 'DRY RUN (no changes)'}`);
  console.log('---');

  // Posts that:
  //   1. Have a snapshot today (so deleting it kicks them back in the queue)
  //   2. Are ≤24 months old, activity URN (the queue's eligibility filter)
  //   3. Are ≤360 days old (within demographic-retention window)
  //   4. Have <25 demographic rows for today (not yet fully enriched)
  const targets = (await db.execute(sql`
    SELECT
      s.id AS snapshot_id,
      s.activity_id,
      p.posted_at::text AS posted,
      EXTRACT(DAY FROM now() - p.posted_at)::int AS age_days,
      s.impressions,
      (SELECT COUNT(*)::int FROM post_demographics d
       WHERE d.activity_id = s.activity_id
         AND d.snapshot_date = CURRENT_DATE) AS demos_today
    FROM post_snapshots s
    JOIN posts p ON p.activity_id = s.activity_id
    WHERE s.snapshot_date = CURRENT_DATE
      AND p.posted_at >= now() - interval '24 months'
      AND p.posted_at >= now() - interval '360 days'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND (
        SELECT COUNT(*) FROM post_demographics d
        WHERE d.activity_id = s.activity_id
          AND d.snapshot_date = CURRENT_DATE
      ) < 25
    ORDER BY s.impressions DESC
  `)) as unknown as Array<{
    snapshot_id: number;
    activity_id: string;
    posted: string;
    age_days: number;
    impressions: number;
    demos_today: number;
  }>;

  // Also count posts that need capture but DON'T have today's snap —
  // these don't need deletion (already in queue) but show them as
  // context so the user knows the full backfill scope.
  const noSnapToday = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM posts p
    WHERE p.posted_at >= now() - interval '24 months'
      AND p.posted_at >= now() - interval '360 days'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND NOT EXISTS (
        SELECT 1 FROM post_snapshots s
        WHERE s.activity_id = p.activity_id
          AND s.snapshot_date = CURRENT_DATE
      )
  `)) as unknown as Array<{ n: number }>;

  console.log(`Snapshots to delete (will re-enter the queue): ${targets.length}`);
  console.log(`Already in queue (no snapshot today): ${noSnapToday[0].n}`);
  console.log(`Total backfill scope after refill: ${targets.length + noSnapToday[0].n}`);
  console.log(`Total impressions across deletion targets: ${targets.reduce((a, r) => a + r.impressions, 0)}`);
  console.log('');

  if (targets.length === 0) {
    console.log('Nothing to delete — every in-window ≤360d post is already enriched.');
    return;
  }

  console.log('Top 10 deletion targets by impressions:');
  for (const r of targets.slice(0, 10)) {
    console.log(
      `  ${r.activity_id} posted=${r.posted.slice(0, 10)} ` +
        `age=${r.age_days}d imp=${r.impressions} demos_today=${r.demos_today}`,
    );
  }
  if (targets.length > 10) console.log(`  ... and ${targets.length - 10} more`);

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to delete.');
    return;
  }

  const ids = targets.map((r) => r.snapshot_id);
  const result = (await db.execute(sql`
    DELETE FROM post_snapshots
    WHERE id IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )})
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  console.log(`\nDeleted ${result.length} snapshot row(s).`);
  console.log(
    'Next: reload extension, click "Backfill now", let it run ~60 min.',
  );
  console.log(
    `Expected outcome: ${targets.length + noSnapToday[0].n} posts captured with ~30 demographic rows each.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
