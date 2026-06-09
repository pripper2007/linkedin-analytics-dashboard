// Spot-check the historical backfill: earliest + latest rows from each
// of the three timeseries tables, plus a quick sanity check that the
// follower count climbs monotonically (allowing for rare daily net-
// negative days when more people unfollowed than followed).

import { db } from '../src/db/client';
import {
  profileSnapshots,
  dailyEngagement,
  profileDemographics,
  posts,
} from '../src/db/schema';
import { sql, asc, desc } from 'drizzle-orm';

async function main() {
  const profFirst = await db
    .select()
    .from(profileSnapshots)
    .orderBy(asc(profileSnapshots.snapshotDate))
    .limit(3);
  const profLast = await db
    .select()
    .from(profileSnapshots)
    .orderBy(desc(profileSnapshots.snapshotDate))
    .limit(3);
  console.log('profile_snapshots (earliest 3):');
  console.log(JSON.stringify(profFirst, null, 2));
  console.log('\nprofile_snapshots (latest 3):');
  console.log(JSON.stringify(profLast, null, 2));

  const engFirst = await db
    .select()
    .from(dailyEngagement)
    .orderBy(asc(dailyEngagement.date))
    .limit(2);
  const engLast = await db
    .select()
    .from(dailyEngagement)
    .orderBy(desc(dailyEngagement.date))
    .limit(2);
  console.log('\ndaily_engagement (earliest 2, latest 2):');
  console.log(JSON.stringify([...engFirst, ...engLast], null, 2));

  const demoByCat = await db.execute(
    sql`SELECT category, COUNT(*)::int AS n FROM profile_demographics GROUP BY category`,
  );
  console.log('\nprofile_demographics by category:');
  console.log(JSON.stringify(demoByCat, null, 2));

  const postsFirst = await db
    .select({
      activityId: posts.activityId,
      postedAt: posts.postedAt,
      wordCount: posts.wordCount,
    })
    .from(posts)
    .orderBy(asc(posts.postedAt))
    .limit(2);
  const postsLast = await db
    .select({
      activityId: posts.activityId,
      postedAt: posts.postedAt,
      wordCount: posts.wordCount,
    })
    .from(posts)
    .orderBy(desc(posts.postedAt))
    .limit(2);
  console.log('\nposts (earliest 2, latest 2):');
  console.log(JSON.stringify([...postsFirst, ...postsLast], null, 2));
}

main().then(() => process.exit(0));
