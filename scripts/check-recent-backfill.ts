import { db } from '../src/db/client';
import { posts, postSnapshots, postDemographics } from '../src/db/schema';
import { sql, desc, gte, and, eq } from 'drizzle-orm';

async function main() {
  // Total posts
  const [{ totalPosts }] = await db.execute(
    sql`SELECT COUNT(*)::int AS "totalPosts" FROM posts`
  ) as any;
  
  // Total snapshots
  const [{ totalSnaps }] = await db.execute(
    sql`SELECT COUNT(*)::int AS "totalSnaps" FROM post_snapshots`
  ) as any;
  
  console.log('=== DB totals ===');
  console.log(`posts: ${totalPosts}`);
  console.log(`post_snapshots: ${totalSnaps}`);
  
  // Posts that have NO snapshots at all (holes)
  const holes = await db.execute(sql`
    SELECT p.activity_id, p.posted_at, p.post_url, p.id_resolve_attempted_at
    FROM posts p
    LEFT JOIN post_snapshots s ON s.activity_id = p.activity_id
    WHERE s.id IS NULL
    ORDER BY p.posted_at DESC
  `);
  console.log(`\n=== Posts with ZERO snapshots: ${(holes as any).length} ===`);
  console.log(JSON.stringify(holes, null, 2));
  
  // Snapshots captured in last 4 hours
  const recent = await db.execute(sql`
    SELECT 
      s.activity_id,
      s.snapshot_date,
      s.captured_at,
      s.data_source,
      s.impressions,
      s.engagement_rate,
      p.posted_at
    FROM post_snapshots s
    JOIN posts p ON p.activity_id = s.activity_id
    WHERE s.captured_at >= NOW() - INTERVAL '4 hours'
    ORDER BY s.captured_at DESC
  `);
  console.log(`\n=== Snapshots captured in last 4h: ${(recent as any).length} ===`);
  console.log(JSON.stringify(recent, null, 2));
  
  // Demographics rows in last 4h
  const recentDemo = await db.execute(sql`
    SELECT activity_id, snapshot_date, COUNT(*)::int AS n
    FROM post_demographics
    WHERE activity_id IN (
      SELECT DISTINCT activity_id FROM post_snapshots
      WHERE captured_at >= NOW() - INTERVAL '4 hours'
    )
    GROUP BY activity_id, snapshot_date
    ORDER BY activity_id
  `);
  console.log(`\n=== Demographics rows for posts touched in last 4h ===`);
  console.log(JSON.stringify(recentDemo, null, 2));
  
  // Snapshot coverage by data_source overall
  const bySource = await db.execute(sql`
    SELECT data_source, COUNT(*)::int AS n FROM post_snapshots GROUP BY data_source
  `);
  console.log(`\n=== Snapshots by data_source ===`);
  console.log(JSON.stringify(bySource, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
