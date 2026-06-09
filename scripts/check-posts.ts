import { db } from '../src/db/client';
import { posts } from '../src/db/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select({
      activityId: posts.activityId,
      postedAt: posts.postedAt,
      postUrl: posts.postUrl,
    })
    .from(posts)
    .orderBy(desc(posts.postedAt))
    .limit(5);
  console.log(JSON.stringify(rows, null, 2));
}

main().then(() => process.exit(0));
