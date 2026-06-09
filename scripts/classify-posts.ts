// Backfills topic/style on posts where they're currently null.
//
// Runs the keyword classifier from src/lib/post-classifier.ts and
// writes results via UPDATE ... SET topic = COALESCE(topic, ...),
// style = COALESCE(style, ...) — never overwrites an existing value
// so manual classifications are safe.
//
// Idempotent. Safe to re-run whenever the classifier rules evolve
// (re-runs only affect still-null rows).
//
// Usage: npx tsx --env-file=.env.local scripts/classify-posts.ts

import { db } from '../src/db/client';
import { posts } from '../src/db/schema';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { classifyPost } from '../src/lib/post-classifier';

async function main() {
  const rows = await db
    .select({
      activityId: posts.activityId,
      postContent: posts.postContent,
      topic: posts.topic,
      style: posts.style,
    })
    .from(posts)
    .where(or(isNull(posts.topic), isNull(posts.style)));

  console.log(`posts with null topic or style: ${rows.length}`);

  let updated = 0;
  const topicCounts = new Map<string, number>();
  const styleCounts = new Map<string, number>();

  for (const r of rows) {
    const c = classifyPost(r.postContent);
    // Build a partial update: only touch columns that are currently null.
    const patch: Partial<{ topic: string | null; style: string | null }> = {};
    if (r.topic == null && c.topic != null) patch.topic = c.topic;
    if (r.style == null && c.style != null) patch.style = c.style;
    if (Object.keys(patch).length === 0) continue;
    await db.update(posts).set(patch).where(eq(posts.activityId, r.activityId));
    updated++;
    if (patch.topic) {
      topicCounts.set(patch.topic, (topicCounts.get(patch.topic) ?? 0) + 1);
    }
    if (patch.style) {
      styleCounts.set(patch.style, (styleCounts.get(patch.style) ?? 0) + 1);
    }
  }

  console.log(`\n${updated} posts updated.`);
  console.log('Topics assigned (only where previously null):');
  for (const [t, n] of [...topicCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${t}`);
  }
  console.log('Styles assigned (only where previously null):');
  for (const [s, n] of [...styleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${s}`);
  }

  // Final view of vocab distribution after the backfill.
  const topicDist = (await db.execute(sql`
    SELECT COALESCE(topic, '(null)') AS v, COUNT(*)::int AS n
    FROM posts GROUP BY v ORDER BY n DESC
  `)) as unknown as Array<{ v: string; n: number }>;
  const styleDist = (await db.execute(sql`
    SELECT COALESCE(style, '(null)') AS v, COUNT(*)::int AS n
    FROM posts GROUP BY v ORDER BY n DESC
  `)) as unknown as Array<{ v: string; n: number }>;
  console.log('\nFinal distribution — topics:');
  for (const r of topicDist) console.log(`  ${r.n.toString().padStart(4)}  ${r.v}`);
  console.log('Final distribution — styles:');
  for (const r of styleDist) console.log(`  ${r.n.toString().padStart(4)}  ${r.v}`);

  // Hint about nulls that remain: post content likely doesn't match
  // any topic rule. Keep them as null (display falls back to 'General')
  // — the user can hand-classify later if they care to.
  const stillNullTopics = topicDist.find((r) => r.v === '(null)')?.n ?? 0;
  if (stillNullTopics > 0) {
    console.log(
      `\nNote: ${stillNullTopics} posts still have null topic — their content didn't match any rule. ` +
        `That's OK; the dashboard shows them as 'General'. Tune classifier rules or hand-classify as needed.`,
    );
  }
  // Suppress the unused-import warning from and/.
  void and;
}

main().then(() => process.exit(0));
