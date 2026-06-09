// Zod schema for the /api/ingest POST body.
//
// This is the contract between the Chrome extension and the server. The
// extension captures Voyager API responses client-side and reshapes them
// into this flat form before POSTing. Keep the shape stable — bumping it
// is a breaking change for every already-installed extension.

import { z } from 'zod';

// A single post entry: stable metadata + the current day's metrics + optional
// demographic snapshot. Metadata fields are required because they power the
// FK-bearing `posts` row; if the extension can't read them, it should skip
// the post rather than send a partial record.
const demographicEntrySchema = z.object({
  category: z.enum([
    'job_title',
    'location',
    'seniority',
    'company',
    'industry',
    'company_size',
  ]),
  value: z.string().min(1),
  // Numeric — extension is responsible for converting "35%" / "<1%" strings
  // from Voyager responses into a numeric value (using the same midpoint
  // convention as scripts/seed-transforms.ts::parsePct).
  pct: z.number().min(0).max(100),
  rank: z.number().int().min(1),
});

const postIngestSchema = z.object({
  activityId: z.string().min(1),

  // Stable post metadata — OPTIONAL after Phase 3d.B.
  //
  // The feed-updates capture path provides all of these (postContent,
  // postUrl, postedAt, has* flags, etc.) because the feed response is
  // where LinkedIn exposes post content. The post-summary DOM capture
  // (Phase 3d.B) does NOT have access to the full post metadata — it's
  // the analytics page, not the post's own page. A post-summary capture
  // is therefore metrics-only; it assumes the post row already exists
  // from a prior feed capture or legacy backfill.
  //
  // Rule enforced at route time: if postContent is absent, we skip the
  // posts-row upsert and only write to post_snapshots. If postContent
  // IS present, we also upsert the posts row as before.
  postContent: z.string().optional(),
  postUrl: z.string().url().optional(),
  postedAt: z.string().datetime().optional(),
  topic: z.string().optional(),
  style: z.string().optional(),
  imageType: z.string().optional(),
  wordCount: z.number().int().nonnegative().optional(),
  paragraphCount: z.number().int().nonnegative().optional(),
  hasLink: z.boolean().optional(),
  hasImage: z.boolean().optional(),
  hasBoldUnicode: z.boolean().optional(),
  hasEmoji: z.boolean().optional(),
  hasBulletPoints: z.boolean().optional(),
  hasQuestion: z.boolean().optional(),
  featureCount: z.number().int().nonnegative().optional(),

  // Snapshot core — only snapshotDate is strictly required. impressions
  // USED to be required (it was "the one metric every capture path
  // returns"), but the post-summary DOM scrape fails to extract it
  // when LinkedIn's page hasn't finished hydrating. Coercing to 0
  // keeps the batch valid; the route's hasMeaningfulMetrics guard
  // then skips inserting an all-zero snapshot.
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  impressions: z.number().int().nonnegative().default(0),
  membersReached: z.number().int().nonnegative().optional(),
  socialEngagements: z.number().int().nonnegative().optional(),
  reactionsTotal: z.number().int().nonnegative().optional(),
  reactionsLike: z.number().int().nonnegative().optional(),
  reactionsCelebrate: z.number().int().nonnegative().optional(),
  reactionsSupport: z.number().int().nonnegative().optional(),
  reactionsLove: z.number().int().nonnegative().optional(),
  reactionsInsightful: z.number().int().nonnegative().optional(),
  reactionsFunny: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  reposts: z.number().int().nonnegative().optional(),
  saves: z.number().int().nonnegative().optional(),
  sends: z.number().int().nonnegative().optional(),
  linkClicks: z.number().int().nonnegative().optional(),
  profileViewers: z.number().int().nonnegative().optional(),
  followersGained: z.number().int().nonnegative().optional(),
  engagementRate: z.number().nonnegative().optional(),

  // Video-post metrics — populated by the post-summary DOM scrape added
  // in Phase 3d.B. Absent / null for non-video posts.
  videoViews: z.number().int().nonnegative().optional(),
  watchTimeSeconds: z.number().int().nonnegative().optional(),
  averageWatchTimeSeconds: z.number().int().nonnegative().optional(),

  demographics: z.array(demographicEntrySchema).optional(),

  // Image/video URLs from the LinkedIn CDN. Persisted into post_media
  // (sourceUrl). A future Vercel Blob mirroring step fills blobUrl
  // for durability — LinkedIn CDN URLs include short-lived signed
  // tokens and break for older posts.
  media: z
    .array(
      z.object({
        kind: z.enum(['image', 'video', 'video_thumbnail', 'document']),
        sourceUrl: z.string().url(),
      }),
    )
    .optional(),
});

const profileIngestSchema = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // At least one of totalFollowers / totalConnections must be present —
  // enforced below. Both optional here so a capture with only connections
  // (visited profile but not recent-activity, or vice versa) is still
  // accepted.
  totalFollowers: z.number().int().nonnegative().optional(),
  totalConnections: z.number().int().nonnegative().optional(),
  followerGrowth12mo: z.number().int().optional(),
  totalImpressions12mo: z.number().int().nonnegative().optional(),
  totalEngagements12mo: z.number().int().nonnegative().optional(),
}).refine(
  (p) => p.totalFollowers !== undefined || p.totalConnections !== undefined,
  { message: 'profile must include totalFollowers or totalConnections' },
);

export const ingestPayloadSchema = z.object({
  // When the extension captured this batch. Used only for ingest_log /
  // diagnostics; it does not drive the snapshot_date.
  capturedAt: z.string().datetime(),

  // Identifier for the ingest source — stamped into ingest_log so we can
  // tell a seed run apart from an extension run.
  source: z.string().min(1),

  posts: z.array(postIngestSchema),
  profile: profileIngestSchema.optional(),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type PostIngest = z.infer<typeof postIngestSchema>;
export type ProfileIngest = z.infer<typeof profileIngestSchema>;
export type DemographicEntryIngest = z.infer<typeof demographicEntrySchema>;
