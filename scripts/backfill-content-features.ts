// Recomputes feature flags (has_link, has_emoji, has_bullet_points,
// has_question, has_bold_unicode) for every post in the DB from the
// stored post_content. Also refreshes has_image from the image_type
// column where image_type is known.
//
// Why: posts captured by the browser extension between Phase 3d
// landing and this backfill have all feature flags stuck at `false`
// because the extension doesn't compute them. Legacy seeded posts had
// them pre-computed in the JSON.
//
// Idempotent. Safe to re-run whenever detection rules change.
//
// Usage: npx tsx --env-file=.env.local scripts/backfill-content-features.ts

import { db } from '../src/db/client';
import { posts } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import {
  detectFeatures,
  countContentFeatures,
  hasImageFromType,
} from '../src/lib/content-features';

async function main() {
  const rows = await db
    .select({
      activityId: posts.activityId,
      postContent: posts.postContent,
      imageType: posts.imageType,
      hasImage: posts.hasImage,
      hasLink: posts.hasLink,
      hasEmoji: posts.hasEmoji,
      hasBulletPoints: posts.hasBulletPoints,
      hasQuestion: posts.hasQuestion,
      hasBoldUnicode: posts.hasBoldUnicode,
      featureCount: posts.featureCount,
    })
    .from(posts);

  console.log(`Scanning ${rows.length} posts…`);

  let updated = 0;
  const flagDeltas = {
    hasLink: 0,
    hasEmoji: 0,
    hasBulletPoints: 0,
    hasQuestion: 0,
    hasBoldUnicode: 0,
    hasImage: 0,
  };

  for (const r of rows) {
    const detected = detectFeatures(r.postContent ?? '');
    const imageFromType = hasImageFromType(r.imageType);
    // Only overwrite has_image if image_type gives us a signal; otherwise
    // preserve whatever was there (legacy JSON values).
    const nextHasImage = imageFromType ?? r.hasImage;

    const next = {
      hasLink: detected.hasLink,
      hasEmoji: detected.hasEmoji,
      hasBulletPoints: detected.hasBulletPoints,
      hasQuestion: detected.hasQuestion,
      hasBoldUnicode: detected.hasBoldUnicode,
      hasImage: nextHasImage,
      featureCount:
        countContentFeatures(detected) + (nextHasImage ? 1 : 0),
    };

    const changed =
      next.hasLink !== r.hasLink ||
      next.hasEmoji !== r.hasEmoji ||
      next.hasBulletPoints !== r.hasBulletPoints ||
      next.hasQuestion !== r.hasQuestion ||
      next.hasBoldUnicode !== r.hasBoldUnicode ||
      next.hasImage !== r.hasImage ||
      next.featureCount !== r.featureCount;

    if (!changed) continue;

    // Tally per-flag deltas (# of rows that flipped false→true)
    (['hasLink', 'hasEmoji', 'hasBulletPoints', 'hasQuestion', 'hasBoldUnicode', 'hasImage'] as const).forEach(
      (k) => {
        if (r[k] === false && next[k] === true) flagDeltas[k]++;
      },
    );

    await db
      .update(posts)
      .set(next)
      .where(eq(posts.activityId, r.activityId));
    updated++;
  }

  console.log(`\n${updated} posts updated.`);
  console.log('Flags flipped false → true:');
  for (const [k, n] of Object.entries(flagDeltas)) {
    console.log(`  ${n.toString().padStart(4)}  ${k}`);
  }
}

main().then(() => process.exit(0));
