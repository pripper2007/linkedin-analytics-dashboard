import { db } from '../src/db/client';
import { ingestLog } from '../src/db/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select()
    .from(ingestLog)
    .orderBy(desc(ingestLog.startedAt))
    .limit(10);
  console.log(`${rows.length} recent ingest_log rows:`);
  console.log(JSON.stringify(rows, null, 2));
}

main().then(() => process.exit(0));
