// Inventory existing topic/style values in the DB to design a
// classifier that matches the vocabulary Pedro already had in the
// legacy seed data.

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('=== Topic values ===');
  const topics = (await db.execute(sql`
    SELECT COALESCE(topic, '(null)') AS topic, COUNT(*)::int AS n
    FROM posts
    GROUP BY topic
    ORDER BY n DESC
  `)) as unknown as Array<{ topic: string; n: number }>;
  for (const t of topics) console.log(`  ${t.n.toString().padStart(4)}  ${t.topic}`);

  console.log('\n=== Style values ===');
  const styles = (await db.execute(sql`
    SELECT COALESCE(style, '(null)') AS style, COUNT(*)::int AS n
    FROM posts
    GROUP BY style
    ORDER BY n DESC
  `)) as unknown as Array<{ style: string; n: number }>;
  for (const s of styles) console.log(`  ${s.n.toString().padStart(4)}  ${s.style}`);

  console.log('\n=== Sample posts per (topic, style) pair ===');
  const samples = (await db.execute(sql`
    SELECT
      COALESCE(topic, '(null)') AS topic,
      COALESCE(style, '(null)') AS style,
      (SELECT post_content FROM posts p2
       WHERE COALESCE(p2.topic, '__') = COALESCE(p.topic, '__')
         AND COALESCE(p2.style, '__') = COALESCE(p.style, '__')
       ORDER BY posted_at DESC LIMIT 1) AS example
    FROM posts p
    GROUP BY p.topic, p.style
    ORDER BY topic, style
  `)) as unknown as Array<{ topic: string; style: string; example: string }>;
  for (const s of samples) {
    const snippet = (s.example ?? '').slice(0, 100).replace(/\s+/g, ' ');
    console.log(`  [${s.topic} / ${s.style}]  "${snippet}"`);
  }
}

main().then(() => process.exit(0));
