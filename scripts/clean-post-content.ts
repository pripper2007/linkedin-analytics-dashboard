// One-shot cleanup of post.post_content rows that carry LinkedIn's
// CSV-paragraph-quoting artifact (every paragraph wrapped in `"`,
// blank lines as `""`). Idempotent: re-running produces the same
// output (the cleanup is a no-op on already-clean content).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/clean-post-content.ts          # dry run
//   npx tsx --env-file=.env.local scripts/clean-post-content.ts --apply  # write

import { db } from '../src/db/client';
import { posts } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { cleanLinkedInCsvQuotes } from '../src/lib/clean-linkedin-csv-quotes';
import {
  countWordsAndParagraphs,
  detectFeatures,
  countContentFeatures,
} from '../src/lib/content-features';

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await db.select({
    activityId: posts.activityId,
    postContent: posts.postContent,
    hasImage: posts.hasImage,
  }).from(posts);

  let dirty = 0;
  let clean = 0;
  let updated = 0;

  for (const r of rows) {
    if (!r.postContent) {
      clean++;
      continue;
    }
    const cleaned = cleanLinkedInCsvQuotes(r.postContent);
    if (cleaned === r.postContent) {
      clean++;
      continue;
    }
    dirty++;

    if (!apply) {
      // Show one-line diff: lengths.
      console.log(`  ${r.activityId}: ${r.postContent.length} → ${cleaned.length} chars`);
      continue;
    }

    // Recompute downstream attributes since content shape changed
    // (paragraph count especially — was inflated by the spurious quotes).
    const features = detectFeatures(cleaned);
    const counts = countWordsAndParagraphs(cleaned);
    const featureCount = countContentFeatures(features) + (r.hasImage ? 1 : 0);

    await db.update(posts).set({
      postContent: cleaned,
      hasLink: features.hasLink,
      hasEmoji: features.hasEmoji,
      hasBulletPoints: features.hasBulletPoints,
      hasQuestion: features.hasQuestion,
      hasBoldUnicode: features.hasBoldUnicode,
      wordCount: counts.wordCount,
      paragraphCount: counts.paragraphCount,
      featureCount,
    }).where(eq(posts.activityId, r.activityId));
    updated++;
  }

  console.log(`---`);
  console.log(`scanned:  ${rows.length}`);
  console.log(`already clean: ${clean}`);
  console.log(`dirty (CSV-quoted): ${dirty}`);
  if (apply) {
    console.log(`updated: ${updated}`);
  } else {
    console.log(`Dry run only. Re-run with --apply to write.`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
