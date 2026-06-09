import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const rows = (await db.execute(sql`
    SELECT activity_id, impressions, reactions_total, comments, reposts,
           saves, sends, profile_viewers, followers_gained, link_clicks,
           video_views, watch_time_seconds, average_watch_time_seconds,
           data_source, captured_at
    FROM post_snapshots
    WHERE snapshot_date = CURRENT_DATE
    ORDER BY captured_at DESC
    LIMIT 25
  `)) as unknown as Record<string, unknown>[];
  console.log(`today's post_snapshots: ${rows.length} rows`);
  const withNew = rows.filter(
    (r) =>
      Number(r.saves ?? 0) > 0 ||
      Number(r.sends ?? 0) > 0 ||
      Number(r.video_views ?? 0) > 0 ||
      Number(r.followers_gained ?? 0) > 0 ||
      Number(r.profile_viewers ?? 0) > 0,
  );
  console.log(`rows with post-summary fields populated: ${withNew.length}`);
  console.log('---');
  console.log('first 3 with new fields (if any):');
  for (const r of withNew.slice(0, 3)) console.log(JSON.stringify(r));
  console.log('---');
  console.log('5 newest rows overall:');
  for (const r of rows.slice(0, 5)) console.log(JSON.stringify(r));
}

main().then(() => process.exit(0));
