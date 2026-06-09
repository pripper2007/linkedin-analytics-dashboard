// Option B refill — delete today's post_snapshots for posts that have a
// snapshot today BUT no demographics, so the backfill orchestrator re-
// surfaces them and re-captures them with the new parser (which now
// extracts the audience-breakdown section).
//
// Safe to re-run. By default does a dry-run; pass --apply to actually
// delete. Posts that already have demographics from prior captures keep
// their full time-series untouched (no rows deleted).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/refill-demographics.ts
//   npx tsx --env-file=.env.local scripts/refill-demographics.ts --apply

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(`Mode: ${apply ? 'APPLY (will delete rows)' : 'DRY RUN (no changes)'}`);
  console.log('---');

  // Find today's snapshots for posts that have NO demographics rows at all
  // (any date). These are the captures the new parser would enrich.
  const targets = (await db.execute(sql`
    SELECT s.activity_id, s.id AS snapshot_id, s.impressions, s.captured_at
    FROM post_snapshots s
    WHERE s.snapshot_date = CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM post_demographics d
        WHERE d.activity_id = s.activity_id
      )
    ORDER BY s.impressions DESC
  `)) as unknown as Array<{
    activity_id: string;
    snapshot_id: number;
    impressions: number;
    captured_at: string;
  }>;

  console.log(`Snapshots that will be deleted: ${targets.length}`);
  if (targets.length === 0) {
    console.log('Nothing to do — every post captured today already has demographics.');
    return;
  }

  // Sanity: are these all from today's backfill window?
  const minCap = targets.reduce(
    (a, r) => (r.captured_at < a ? r.captured_at : a),
    targets[0].captured_at,
  );
  const maxCap = targets.reduce(
    (a, r) => (r.captured_at > a ? r.captured_at : a),
    targets[0].captured_at,
  );
  console.log(`Capture window: ${minCap} → ${maxCap}`);
  console.log(`Total impressions across the targets: ${targets.reduce((a, r) => a + r.impressions, 0)}`);
  console.log('Sample (top 10 by impressions):');
  for (const r of targets.slice(0, 10)) {
    console.log(`  ${r.activity_id}  imp=${String(r.impressions).padStart(6)}  captured=${r.captured_at.slice(0, 19)}`);
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to delete.');
    return;
  }

  // Delete the snapshots. Cascading FK removes any reaction-by-type rows
  // (no separate table here — they're columns on post_snapshots itself).
  const ids = targets.map((r) => r.snapshot_id);
  const result = await db.execute(sql`
    DELETE FROM post_snapshots
    WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  console.log(`\nDeleted ${result.length} snapshot row(s).`);
  console.log('Next: reload the extension and click "Backfill now" — these');
  console.log('posts will be at the top of the queue and capture with demographics.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
