// One-shot seed script.
//
// Reads data/linkedin_analytics_master.json and writes it into Supabase.
// Idempotent: safe to run multiple times. Shares its per-table upsert logic
// with /api/ingest via src/db/upserts.ts.
//
// Run with: npm run db:seed
// The npm script uses `tsx --env-file=.env.local` so env vars are loaded
// before any import runs — don't re-add dotenv here.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';

import { db, sql } from '../src/db/client';
import { ingestLog } from '../src/db/schema';
import {
  upsertPost,
  upsertPostSnapshot,
  upsertPostDemographic,
  upsertProfileSnapshot,
  upsertDailyEngagement,
} from '../src/db/upserts';
import type { AnalyticsMaster } from '../src/lib/types';
import {
  toPostRow,
  toSnapshotRow,
  toDemographicRows,
  toProfileSnapshotRow,
  toDailyEngagementRow,
} from './seed-transforms';

async function main() {
  const [logEntry] = await db
    .insert(ingestLog)
    .values({ status: 'success', source: 'seed' })
    .returning();

  try {
    const jsonPath = resolve(
      process.cwd(),
      'data/linkedin_analytics_master.json',
    );
    const raw = readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw) as AnalyticsMaster;

    // Use the JSON's last_updated as the snapshot date so future daily
    // captures line up naturally after this seed.
    const snapshotDate = data._metadata.last_updated;
    console.log(
      `Seeding ${data.posts.length} posts with snapshot date ${snapshotDate}`,
    );

    for (const p of data.posts) {
      await upsertPost(db, toPostRow(p));
    }
    console.log(`  ✓ posts: ${data.posts.length} rows upserted`);

    for (const p of data.posts) {
      await upsertPostSnapshot(db, toSnapshotRow(p, snapshotDate));
    }
    console.log(`  ✓ post_snapshots: ${data.posts.length} rows upserted`);

    let demoCount = 0;
    for (const p of data.posts) {
      const rows = toDemographicRows(p.activity_id, snapshotDate, p.demographics);
      for (const row of rows) {
        await upsertPostDemographic(db, row);
        demoCount++;
      }
    }
    console.log(`  ✓ post_demographics: ${demoCount} rows upserted`);

    await upsertProfileSnapshot(db, toProfileSnapshotRow(data.profile, snapshotDate));
    console.log('  ✓ profile_snapshots: 1 row upserted');

    for (const entry of data.daily_engagement) {
      await upsertDailyEngagement(db, toDailyEngagementRow(entry));
    }
    console.log(
      `  ✓ daily_engagement: ${data.daily_engagement.length} rows upserted`,
    );

    await db
      .update(ingestLog)
      .set({
        finishedAt: new Date(),
        status: 'success',
        postsCaptured: data.posts.length,
      })
      .where(eq(ingestLog.id, logEntry.id));

    console.log('\n✓ Seed complete');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('✗ Seed failed:', msg);
    throw err;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
