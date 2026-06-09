// One-shot data rescue: delete the partial-parse snapshot for activity
// 7379847772230852608 (3-out-2025) so the next backfill pass treats it
// as never-captured and re-runs the analytics scrape from scratch.
//
// Why: that snapshot has impressions=0 + members_reached=18165 +
// engagements=422 — the parser succeeded on the engagement row but
// missed the top-card "Impressions" line. With the new stricter
// hasMeaningfulMetrics (requires a reach signal), a re-capture
// will correctly drop the partial result, but we still need to
// clear the existing bad row so the queue re-prioritizes the post.
//
// Idempotent. Reports what (if anything) was deleted.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/rescue-oct3-snapshot.ts

import { sql as pg } from '../src/db/client';

const TARGET = '7379847772230852608';

async function main() {
  // 1. Find any snapshot whose impressions=0 but members_reached>0 — the
  //    exact failure shape we want to retry. Includes the 3-out post
  //    plus any silent siblings.
  const targets = (await pg`
    SELECT activity_id, snapshot_date, impressions, members_reached, social_engagements
    FROM post_snapshots
    WHERE impressions = 0 AND members_reached > 0
    ORDER BY snapshot_date DESC
  `) as unknown as Array<{
    activity_id: string;
    snapshot_date: string;
    impressions: number;
    members_reached: number;
    social_engagements: number;
  }>;

  console.log(`Snapshots with impressions=0 but reach>0: ${targets.length}`);
  for (const r of targets) {
    console.log(
      `  ${r.activity_id} ${r.snapshot_date} reach=${r.members_reached} eng=${r.social_engagements}`,
    );
  }

  if (targets.length === 0) {
    console.log('Nothing to rescue.');
    process.exit(0);
  }

  const deleted = await pg`
    DELETE FROM post_snapshots
    WHERE impressions = 0 AND members_reached > 0
    RETURNING activity_id, snapshot_date
  `;
  console.log(`\nDeleted ${deleted.length} snapshot(s).`);

  // 2. Confirm the target now appears at the top of the queue (highest
  //    priority = never-captured first).
  const queue = (await pg`
    SELECT p.activity_id,
           p.posted_at,
           EXISTS (
             SELECT 1 FROM post_snapshots s
             WHERE s.activity_id = p.activity_id
               AND s.impressions IS NOT NULL
               AND s.impressions > 0
           ) AS has_real_capture
    FROM posts p
    WHERE p.posted_at >= now() - interval '24 months'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND p.activity_id = ${TARGET}
  `) as unknown as Array<{ activity_id: string; has_real_capture: boolean }>;

  console.log('\nPost 3-out queue status:');
  for (const r of queue) {
    console.log(
      `  ${r.activity_id}: has_real_capture=${r.has_real_capture} → ${
        r.has_real_capture ? 'low priority' : 'HIGH priority (never captured)'
      }`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
