import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  // Mirror what the queue endpoint sees
  const queue = await db.execute(sql`
    SELECT p.activity_id, p.posted_at, p.post_url
    FROM posts p
    WHERE p.posted_at >= now() - interval '24 months'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND NOT EXISTS (
        SELECT 1 FROM post_snapshots ps
        WHERE ps.activity_id = p.activity_id
          AND ps.snapshot_date = CURRENT_DATE
          AND (
            COALESCE(ps.saves, 0) > 0
            OR COALESCE(ps.sends, 0) > 0
            OR COALESCE(ps.profile_viewers, 0) > 0
            OR COALESCE(ps.followers_gained, 0) > 0
          )
      )
    ORDER BY
      EXISTS (
        SELECT 1 FROM post_snapshots s
        WHERE s.activity_id = p.activity_id
          AND s.impressions > 0
      ) ASC,
      p.posted_at DESC
  `) as any;
  
  console.log(`=== Queue (posts needing capture today): ${queue.length} ===`);
  
  // Bucket: never has any reach-signal snapshot vs has but not today
  const noReach = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM posts p
    WHERE p.posted_at >= now() - interval '24 months'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND NOT EXISTS (
        SELECT 1 FROM post_snapshots s
        WHERE s.activity_id = p.activity_id AND s.impressions > 0
      )
  `) as any;
  console.log(`Posts in queue with NO reach-signal snapshot ever: ${noReach[0].n}`);
  
  // Posts that DO have a reach-signal snapshot but are still in queue (need retry today)
  const haveReach = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM posts p
    WHERE p.posted_at >= now() - interval '24 months'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND EXISTS (
        SELECT 1 FROM post_snapshots s
        WHERE s.activity_id = p.activity_id AND s.impressions > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM post_snapshots ps
        WHERE ps.activity_id = p.activity_id
          AND ps.snapshot_date = CURRENT_DATE
          AND (COALESCE(ps.saves,0)>0 OR COALESCE(ps.sends,0)>0
               OR COALESCE(ps.profile_viewers,0)>0
               OR COALESCE(ps.followers_gained,0)>0)
      )
  `) as any;
  console.log(`Posts with reach-signal but no successful capture today: ${haveReach[0].n}`);
  
  // Sample first 15 from queue (highest priority — never captured)
  console.log('\n=== Top 15 in queue (highest priority) ===');
  console.log(JSON.stringify(queue.slice(0, 15), null, 2));
  
  // What ingest landed in the last 4h: count of inserts vs updates
  const inserts4h = await db.execute(sql`
    SELECT 
      activity_id,
      snapshot_date,
      captured_at,
      data_source,
      impressions,
      reactions_total,
      comments,
      reposts,
      saves,
      sends,
      profile_viewers,
      followers_gained
    FROM post_snapshots
    WHERE captured_at >= NOW() - INTERVAL '4 hours'
    ORDER BY captured_at DESC
  `) as any;
  console.log(`\n=== All snapshot rows touched in last 4h: ${inserts4h.length} ===`);
  console.log(JSON.stringify(inserts4h, null, 2));
  
  // Today (UTC) snapshots created
  const todayUTC = await db.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE impressions > 0)::int AS with_reach
    FROM post_snapshots
    WHERE snapshot_date = CURRENT_DATE
  `) as any;
  console.log(`\nSnapshots dated today (CURRENT_DATE): n=${todayUTC[0].n} with_reach=${todayUTC[0].with_reach}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
