// One-shot recompute of post-attribute fields from stored content +
// media presence. Fixes the 16 (and counting) live-captured rows where
// word_count / paragraph_count landed null and has_image landed false
// because the ingest route wasn't computing them from post_content +
// p.media. After this runs, those rows reflect reality.
//
// Idempotent: re-running produces the same final state.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/recompute-post-attrs.ts

import { sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { posts, postMedia } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import {
  detectFeatures,
  countContentFeatures,
  countWordsAndParagraphs,
} from '../src/lib/content-features';

async function main() {
  // All posts that have content. We recompute everything content-
  // derivable from post_content + post_media.
  const rows = await db
    .select({
      activityId: posts.activityId,
      postContent: posts.postContent,
      // Keep the existing imageType in case we want to fall back to it
      // (legacy seed posts have no media[] but do have imageType).
      imageType: posts.imageType,
    })
    .from(posts);

  // Bulk-load media presence so we don't N+1 against post_media.
  const mediaRows = (await db.execute(sql`
    SELECT activity_id,
           BOOL_OR(kind IN ('image', 'video_thumbnail')) AS has_image
    FROM post_media
    GROUP BY activity_id
  `)) as unknown as Array<{ activity_id: string; has_image: boolean }>;
  const mediaByActivity = new Map(
    mediaRows.map((r) => [r.activity_id, r.has_image]),
  );

  let updated = 0;
  let unchanged = 0;
  for (const r of rows) {
    if (!r.postContent) {
      unchanged++;
      continue;
    }
    const features = detectFeatures(r.postContent);
    const counts = countWordsAndParagraphs(r.postContent);
    // has_image: prefer DB media presence; else legacy imageType.
    const mediaHasImage = mediaByActivity.get(r.activityId) ?? false;
    const hasImage =
      mediaHasImage ||
      (r.imageType ? r.imageType !== 'no_image' && r.imageType !== 'none' : false);
    const featureCount =
      countContentFeatures(features) + (hasImage ? 1 : 0);

    await db
      .update(posts)
      .set({
        wordCount: counts.wordCount,
        paragraphCount: counts.paragraphCount,
        hasLink: features.hasLink,
        hasEmoji: features.hasEmoji,
        hasBulletPoints: features.hasBulletPoints,
        hasQuestion: features.hasQuestion,
        hasBoldUnicode: features.hasBoldUnicode,
        hasImage,
        featureCount,
      })
      .where(eq(posts.activityId, r.activityId));
    updated++;
  }

  console.log(`Recomputed ${updated} posts (${unchanged} skipped — no content).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
