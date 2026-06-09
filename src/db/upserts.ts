// Reusable upsert helpers shared by the seed script and the /api/ingest
// Vercel Function.
//
// Every helper is idempotent: running the same input twice produces the
// same final DB state. The ingest endpoint relies on this so the browser
// extension can retry safely, and the seed script relies on it so it can
// be re-run without duplicating rows.

import { sql, eq } from 'drizzle-orm';
import type { DB } from './client';
import {
  posts,
  postSnapshots,
  postDemographics,
  postMedia,
  profileSnapshots,
  profileDemographics,
  dailyEngagement,
  type NewPost,
  type NewPostSnapshot,
  type NewPostDemographic,
  type NewPostMedia,
  type NewProfileSnapshot,
  type NewProfileDemographic,
  type NewDailyEngagementRow,
} from './schema';

// -------------------------------------------------------------------------
// posts (key: activity_id)
//
// The seed script (authoritative source for manually-classified metadata)
// uses this full-update variant. The ingest route should use
// upsertPostFromIngest below so browser captures don't wipe manual
// classifications (topic/style/feature flags the extension doesn't know).
// -------------------------------------------------------------------------
export async function upsertPost(db: DB, row: NewPost): Promise<void> {
  await db
    .insert(posts)
    .values(row)
    .onConflictDoUpdate({
      target: posts.activityId,
      set: {
        postContent: row.postContent,
        postUrl: row.postUrl,
        postedAt: row.postedAt,
        topic: row.topic,
        style: row.style,
        imageType: row.imageType,
        wordCount: row.wordCount,
        paragraphCount: row.paragraphCount,
        hasLink: row.hasLink,
        hasImage: row.hasImage,
        hasBoldUnicode: row.hasBoldUnicode,
        hasEmoji: row.hasEmoji,
        hasBulletPoints: row.hasBulletPoints,
        hasQuestion: row.hasQuestion,
        featureCount: row.featureCount,
        lastUpdatedAt: new Date(),
      },
    });
}

// -------------------------------------------------------------------------
// Extension-safe variant: on conflict, only refresh fields the daily
// browser capture actually knows. Classification/feature fields already
// in the row are preserved. On INSERT (new post the extension saw first),
// the classification fields still get persisted from `row` via the
// .values() call — they just take the null/default shape until some
// authoritative source (seed, future classifier) fills them in.
// -------------------------------------------------------------------------
export async function upsertPostFromIngest(
  db: DB,
  row: NewPost,
): Promise<void> {
  await db
    .insert(posts)
    .values(row)
    .onConflictDoUpdate({
      target: posts.activityId,
      set: {
        // Content can legitimately change if a post is edited on LinkedIn.
        postContent: row.postContent,
        postUrl: row.postUrl,
        // postedAt is immutable in practice; refreshing is harmless.
        postedAt: row.postedAt,
        lastUpdatedAt: new Date(),
        // NOTE: topic, style, imageType, wordCount, paragraphCount, and all
        // has* flags are intentionally omitted — preserved from prior state.
      },
    });
}

// -------------------------------------------------------------------------
// post_snapshots (key: activity_id, snapshot_date)
//
// Re-running the same day's ingest refreshes the snapshot in place. We
// treat 0 / null as "didn't capture" rather than authoritative — partial
// captures (e.g. post-summary scrape that succeeded on reactions but
// failed on impressions) used to clobber a prior good row's values
// with 0s. The CASE WHEN EXCLUDED.x = 0 preservation pattern keeps the
// previous value whenever the incoming row carries no signal for that
// field, while still allowing real updates to flow through.
//
// This is monotonic only for "didn't capture" — a metric that legitimately
// drops (rare; reactions can be unreacted) still updates as long as the
// new value isn't exactly 0.
// -------------------------------------------------------------------------
export async function upsertPostSnapshot(
  db: DB,
  row: NewPostSnapshot,
): Promise<void> {
  // Helper for "preserve old value when incoming is 0" (integer columns).
  const preserve = (col: ReturnType<typeof sql>, fallback: ReturnType<typeof sql>) =>
    sql`CASE WHEN ${col} = 0 THEN ${fallback} ELSE ${col} END`;
  // Same for nullable columns: keep the existing value when the incoming
  // payload didn't include the field (NULL).
  const preserveNullable = (
    col: ReturnType<typeof sql>,
    fallback: ReturnType<typeof sql>,
  ) => sql`COALESCE(${col}, ${fallback})`;

  await db
    .insert(postSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: [postSnapshots.activityId, postSnapshots.snapshotDate],
      set: {
        impressions: preserve(
          sql`EXCLUDED.impressions`,
          sql`${postSnapshots.impressions}`,
        ),
        membersReached: preserve(
          sql`EXCLUDED.members_reached`,
          sql`${postSnapshots.membersReached}`,
        ),
        socialEngagements: preserve(
          sql`EXCLUDED.social_engagements`,
          sql`${postSnapshots.socialEngagements}`,
        ),
        reactionsTotal: preserve(
          sql`EXCLUDED.reactions_total`,
          sql`${postSnapshots.reactionsTotal}`,
        ),
        reactionsLike: preserveNullable(
          sql`EXCLUDED.reactions_like`,
          sql`${postSnapshots.reactionsLike}`,
        ),
        reactionsCelebrate: preserveNullable(
          sql`EXCLUDED.reactions_celebrate`,
          sql`${postSnapshots.reactionsCelebrate}`,
        ),
        reactionsSupport: preserveNullable(
          sql`EXCLUDED.reactions_support`,
          sql`${postSnapshots.reactionsSupport}`,
        ),
        reactionsLove: preserveNullable(
          sql`EXCLUDED.reactions_love`,
          sql`${postSnapshots.reactionsLove}`,
        ),
        reactionsInsightful: preserveNullable(
          sql`EXCLUDED.reactions_insightful`,
          sql`${postSnapshots.reactionsInsightful}`,
        ),
        reactionsFunny: preserveNullable(
          sql`EXCLUDED.reactions_funny`,
          sql`${postSnapshots.reactionsFunny}`,
        ),
        comments: preserve(
          sql`EXCLUDED.comments`,
          sql`${postSnapshots.comments}`,
        ),
        reposts: preserve(
          sql`EXCLUDED.reposts`,
          sql`${postSnapshots.reposts}`,
        ),
        saves: preserve(sql`EXCLUDED.saves`, sql`${postSnapshots.saves}`),
        sends: preserve(sql`EXCLUDED.sends`, sql`${postSnapshots.sends}`),
        linkClicks: preserveNullable(
          sql`EXCLUDED.link_clicks`,
          sql`${postSnapshots.linkClicks}`,
        ),
        profileViewers: preserve(
          sql`EXCLUDED.profile_viewers`,
          sql`${postSnapshots.profileViewers}`,
        ),
        followersGained: preserve(
          sql`EXCLUDED.followers_gained`,
          sql`${postSnapshots.followersGained}`,
        ),
        // Recompute engagement_rate from the final resolved (post-CASE)
        // impressions and social_engagements so the cached ER stays
        // consistent with the components after a partial-capture merge.
        // The dashboard ALSO recomputes on read (queries.ts), so this
        // is belt-and-suspenders — ER stored as 0 from a prior bad
        // capture won't survive the next ingest of the same row.
        engagementRate: sql`
          CASE
            WHEN CASE WHEN EXCLUDED.impressions = 0 THEN ${postSnapshots.impressions} ELSE EXCLUDED.impressions END > 0
            THEN ROUND(
              (CASE WHEN EXCLUDED.social_engagements = 0 THEN ${postSnapshots.socialEngagements} ELSE EXCLUDED.social_engagements END)::numeric
              / (CASE WHEN EXCLUDED.impressions = 0 THEN ${postSnapshots.impressions} ELSE EXCLUDED.impressions END)
              * 100,
              4
            )
            ELSE 0
          END
        `,
        dataSource: sql`EXCLUDED.data_source`,
        capturedAt: new Date(),
      },
    });
}

// -------------------------------------------------------------------------
// post_demographics (key: activity_id, snapshot_date, category, value)
// -------------------------------------------------------------------------
export async function upsertPostDemographic(
  db: DB,
  row: NewPostDemographic,
): Promise<void> {
  await db
    .insert(postDemographics)
    .values(row)
    .onConflictDoUpdate({
      target: [
        postDemographics.activityId,
        postDemographics.snapshotDate,
        postDemographics.category,
        postDemographics.value,
      ],
      set: { pct: row.pct, rank: row.rank },
    });
}

// -------------------------------------------------------------------------
// post_media — multiple rows per post (one per image / video slide).
// No unique constraint on (activity_id, source_url), so we use a
// "replace" pattern: delete prior rows for the activity, insert the
// fresh batch. Idempotent for repeated captures of the same post and
// handles the case where a post's media changes (rare but possible).
// blobUrl preservation: if a row had blobUrl set (mirrored to Vercel
// Blob), the replace would discard it. We work around that by
// querying existing rows first and carrying over the blobUrl when the
// sourceUrl matches.
// -------------------------------------------------------------------------
export async function replacePostMedia(
  db: DB,
  activityId: string,
  rows: NewPostMedia[],
): Promise<void> {
  // Carry forward blob_url from any existing row whose source_url
  // matches one in the incoming batch. Otherwise we'd lose mirrored
  // content every time the post is re-ingested.
  const existing = await db
    .select({ sourceUrl: postMedia.sourceUrl, blobUrl: postMedia.blobUrl })
    .from(postMedia)
    .where(eq(postMedia.activityId, activityId));
  const blobBySource = new Map(
    existing
      .filter((r) => r.blobUrl != null)
      .map((r) => [r.sourceUrl, r.blobUrl as string]),
  );
  const enriched = rows.map((r) => ({
    ...r,
    blobUrl: r.blobUrl ?? blobBySource.get(r.sourceUrl) ?? null,
  }));

  await db.delete(postMedia).where(eq(postMedia.activityId, activityId));
  if (enriched.length > 0) {
    await db.insert(postMedia).values(enriched);
  }
}

// -------------------------------------------------------------------------
// profile_snapshots (key: snapshot_date)
//
// Every field is independently optional. A capture that only sees
// followers shouldn't nuke a previously-captured connection count for
// the same day (and vice versa). So on conflict, we COALESCE the
// incoming value with the existing column value — nulls preserve prior
// state instead of clobbering it. `capturedAt` always refreshes so the
// row reflects when we last touched it.
// -------------------------------------------------------------------------
export async function upsertProfileSnapshot(
  db: DB,
  row: NewProfileSnapshot,
): Promise<void> {
  await db
    .insert(profileSnapshots)
    .values(row)
    .onConflictDoUpdate({
      target: profileSnapshots.snapshotDate,
      set: {
        totalFollowers: sql`COALESCE(EXCLUDED.total_followers, ${profileSnapshots.totalFollowers})`,
        totalConnections: sql`COALESCE(EXCLUDED.total_connections, ${profileSnapshots.totalConnections})`,
        followerGrowth12mo: sql`COALESCE(EXCLUDED.follower_growth_12mo, ${profileSnapshots.followerGrowth12mo})`,
        totalImpressions12mo: sql`COALESCE(EXCLUDED.total_impressions_12mo, ${profileSnapshots.totalImpressions12mo})`,
        totalEngagements12mo: sql`COALESCE(EXCLUDED.total_engagements_12mo, ${profileSnapshots.totalEngagements12mo})`,
        capturedAt: new Date(),
      },
    });
}

// -------------------------------------------------------------------------
// profile_demographics (key: snapshot_date, category, value)
// -------------------------------------------------------------------------
export async function upsertProfileDemographic(
  db: DB,
  row: NewProfileDemographic,
): Promise<void> {
  await db
    .insert(profileDemographics)
    .values(row)
    .onConflictDoUpdate({
      target: [
        profileDemographics.snapshotDate,
        profileDemographics.category,
        profileDemographics.value,
      ],
      set: { pct: row.pct, rank: row.rank },
    });
}

// -------------------------------------------------------------------------
// daily_engagement (key: date)
// -------------------------------------------------------------------------
export async function upsertDailyEngagement(
  db: DB,
  row: NewDailyEngagementRow,
): Promise<void> {
  await db
    .insert(dailyEngagement)
    .values(row)
    .onConflictDoUpdate({
      target: dailyEngagement.date,
      set: {
        impressions: row.impressions,
        engagements: row.engagements,
        dayOfWeek: row.dayOfWeek,
      },
    });
}
