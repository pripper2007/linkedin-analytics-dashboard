import { db } from '../src/db/client';
import { profileSnapshots } from '../src/db/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select()
    .from(profileSnapshots)
    .orderBy(desc(profileSnapshots.snapshotDate))
    .limit(5);
  console.log(JSON.stringify(rows, null, 2));
}

main().then(() => process.exit(0));
