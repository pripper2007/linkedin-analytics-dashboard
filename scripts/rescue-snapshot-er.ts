// One-shot DB rescue: recompute engagement_rate for snapshots whose
// stored ER is 0 but impressions+social_engagements both > 0.
//
// Background: a previous rescue migrated impressions/profile_viewers
// from shifted columns on 2026-05-01 captures, but didn't recompute
// engagement_rate — leaving 8 rows displaying 0% on real engagement.
// The new upsertPostSnapshot recomputes ER on every conflict, and
// queries.ts recomputes on read; this script cleans up the stored
// values so any other consumer (Studio, ad-hoc SQL) sees them right.
//
// Idempotent + safe to re-run. Prints a before/after summary.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/rescue-snapshot-er.ts

import { sql as pg } from '../src/db/client';

async function main() {
  const before = (await pg`
    SELECT activity_id, snapshot_date, impressions, social_engagements, engagement_rate
    FROM post_snapshots
    WHERE impressions > 0
      AND social_engagements > 0
      AND (engagement_rate IS NULL OR engagement_rate = 0)
    ORDER BY snapshot_date DESC
  `) as unknown as Array<{
    activity_id: string;
    snapshot_date: string;
    impressions: number;
    social_engagements: number;
    engagement_rate: string | null;
  }>;

  console.log(`Rows with bad ER: ${before.length}`);
  for (const r of before) {
    const recomputed =
      Math.round((r.social_engagements / r.impressions) * 100 * 10000) / 10000;
    console.log(
      `  ${r.activity_id} ${r.snapshot_date}: ${r.engagement_rate} → ${recomputed}`,
    );
  }

  if (before.length === 0) {
    console.log('Nothing to fix.');
    process.exit(0);
  }

  const result = await pg`
    UPDATE post_snapshots
    SET engagement_rate = ROUND(
      (social_engagements::numeric / impressions) * 100,
      4
    )
    WHERE impressions > 0
      AND social_engagements > 0
      AND (engagement_rate IS NULL OR engagement_rate = 0)
    RETURNING activity_id
  `;
  console.log(`\nUpdated ${result.length} row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
