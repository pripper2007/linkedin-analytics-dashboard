// One-shot backfill: recompute social_engagements and engagement_rate
// on every post_snapshots row from its component metrics.
//
// Why needed: before commit <this one>, the ingest path stored
// social_engagements = payload.socialEngagements ?? 0 (and the extension
// never sends that field, since Voyager / post-summary surfaces only
// the components). That left engagement_rate at 0.00% for every row
// the extension captured, even though reactions/comments/reposts/
// saves/sends all had real numbers. The mapper is now fixed going
// forward; this script repairs the existing data.
//
// Definition (matches mappers.ts::computeSocialEngagements):
//   social_engagements = reactions_total + comments + reposts + saves + sends
//   engagement_rate    = social_engagements / impressions * 100
//                        (0 when impressions = 0)
//
// Idempotent — safe to run multiple times. Run via:
//   npx tsx --env-file=.env.local scripts/backfill-engagement-rates.ts

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

interface Row {
  before_count: number;
  updated_count: number;
}

async function main() {
  // How many rows will change (rough preview — anything whose stored
  // engagement_rate doesn't match what we'd compute).
  const [preview] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM post_snapshots
    WHERE impressions > 0
  `)) as unknown as Array<{ n: number }>;
  console.log(`post_snapshots with impressions > 0: ${preview.n}`);

  // Single UPDATE statement — recomputes both columns from components
  // in one round-trip. Rounded to 4 decimals to match the column
  // precision (numeric(8,4)).
  const result = await db.execute(sql`
    UPDATE post_snapshots
    SET
      social_engagements =
        COALESCE(reactions_total, 0)
        + COALESCE(comments, 0)
        + COALESCE(reposts, 0)
        + COALESCE(saves, 0)
        + COALESCE(sends, 0),
      engagement_rate =
        CASE
          WHEN impressions > 0 THEN
            ROUND(
              (
                (
                  COALESCE(reactions_total, 0)
                  + COALESCE(comments, 0)
                  + COALESCE(reposts, 0)
                  + COALESCE(saves, 0)
                  + COALESCE(sends, 0)
                )::numeric
                / impressions::numeric
              ) * 100,
              4
            )
          ELSE 0
        END
  `);
  console.log(`update complete. command:`, (result as unknown as { command?: string }).command);

  // Show a spot-check: ten rows with the highest engagement rates so we
  // can eyeball whether the computation looks sensible.
  const top = (await db.execute(sql`
    SELECT activity_id, snapshot_date, impressions, reactions_total,
           comments, reposts, saves, sends,
           social_engagements, engagement_rate
    FROM post_snapshots
    WHERE impressions > 100
    ORDER BY engagement_rate DESC
    LIMIT 10
  `)) as unknown as Array<Record<string, unknown>>;
  console.log('\nTop 10 engagement rates after backfill:');
  for (const r of top) {
    console.log(
      `  ${r.activity_id}  imp=${r.impressions}  eng=${r.social_engagements}  rate=${r.engagement_rate}%`,
    );
  }
}

main().then(() => process.exit(0));
