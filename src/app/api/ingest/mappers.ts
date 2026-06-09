// Pure mappers: ingest payload → DB row shape. Factored out of route.ts so
// unit tests can exercise them without importing the DB client.

import type { PostIngest } from './schema';

/**
 * Returns true when the payload carries enough signal to be a useful
 * snapshot. Two layers of skip:
 *
 *  1. No reach signal at all (impressions = 0 AND members_reached = 0):
 *     the LinkedIn analytics page didn't hydrate the top-card section
 *     before the parser ran. Even if reactions / comments came through,
 *     the snapshot is a partial parse — engagement rate has no
 *     denominator and the dashboard can't compute it. Reject so the
 *     orchestrator retries on the next pass instead of writing a
 *     misleading row that displays "—" for impressions but 400+
 *     reactions (this exact bug surfaced for activity 7379847... on
 *     2026-05-01: parser caught the engagement row but missed the
 *     top-card "Impressions 18,165" line).
 *
 *  2. No engagement-row signal either (reach=0, reactions=0, comments=0):
 *     a brand-new post that genuinely has no traction yet. Skip — the
 *     row would just be zeros and pollute the dashboard. Self-heals on
 *     the next capture once the post earns any signal.
 *
 * Net effect: a snapshot lands only when we have both a reach metric
 * AND at least one engagement signal — or we have impressions alone
 * (a brand-new post that's been viewed but not yet reacted to is a
 * legitimate state).
 */
export function hasMeaningfulMetrics(p: PostIngest): boolean {
  const hasReach = p.impressions > 0 || (p.membersReached ?? 0) > 0;
  if (!hasReach) return false;
  return (
    p.impressions > 0 ||
    (p.membersReached ?? 0) > 0 ||
    (p.reactionsTotal ?? 0) > 0 ||
    (p.comments ?? 0) > 0
  );
}

/**
 * True when the payload carries enough stable metadata to upsert the
 * `posts` row (content + URL + postedAt, all of which the DB requires
 * as NOT NULL). The post-summary DOM capture added in Phase 3d.B
 * deliberately omits these — it's snapshot-only, assumes the post row
 * already exists from a prior feed capture or legacy backfill.
 */
export function hasPostMetadata(p: PostIngest): boolean {
  return (
    p.postContent !== undefined &&
    p.postUrl !== undefined &&
    p.postedAt !== undefined
  );
}

/**
 * Total engagements across every interaction type the platform tracks.
 * Canonical definition used throughout the app:
 *   reactions_total + comments + reposts + saves + sends
 * Link-clicks are intentionally excluded — LinkedIn classifies those
 * separately in their own analytics UI ("Link engagements").
 */
export function computeSocialEngagements(p: {
  reactionsTotal?: number | null;
  comments?: number | null;
  reposts?: number | null;
  saves?: number | null;
  sends?: number | null;
}): number {
  return (
    (p.reactionsTotal ?? 0) +
    (p.comments ?? 0) +
    (p.reposts ?? 0) +
    (p.saves ?? 0) +
    (p.sends ?? 0)
  );
}

/**
 * Engagement rate as a percentage: social_engagements / impressions × 100.
 * Returns 0 when impressions is 0 to avoid division by zero (rather than
 * null — the dashboard's sort-by-ER works better when every row has a
 * number). Rounded to 4 decimal places to match the column's precision.
 */
export function computeEngagementRate(
  socialEngagements: number,
  impressions: number,
): number {
  if (impressions <= 0) return 0;
  return Math.round((socialEngagements / impressions) * 100 * 10000) / 10000;
}

/**
 * Maps a validated PostIngest into the shape upsertPostSnapshot expects.
 * Missing optional counts become 0; missing optional reaction-by-type
 * columns become null (distinguishes "not captured" from "captured as 0").
 *
 * social_engagements and engagement_rate are ALWAYS computed here from
 * their constituent fields — the extension doesn't send them directly
 * (LinkedIn's Voyager / post-summary surfaces only the components), so
 * computing at write time keeps every row consistent and the dashboard
 * display correct without a downstream COALESCE.
 */
export function toSnapshotInsert(p: PostIngest) {
  const socialEngagements = computeSocialEngagements(p);
  // If the payload carries an explicit engagementRate (legacy seed path
  // from official_single_post_analytics exports does), trust that —
  // it came from LinkedIn directly. Otherwise compute.
  const engagementRate =
    p.engagementRate !== undefined
      ? p.engagementRate
      : computeEngagementRate(socialEngagements, p.impressions);
  return {
    activityId: p.activityId,
    snapshotDate: p.snapshotDate,
    impressions: p.impressions,
    membersReached: p.membersReached ?? 0,
    socialEngagements,
    reactionsTotal: p.reactionsTotal ?? 0,
    reactionsLike: p.reactionsLike ?? null,
    reactionsCelebrate: p.reactionsCelebrate ?? null,
    reactionsSupport: p.reactionsSupport ?? null,
    reactionsLove: p.reactionsLove ?? null,
    reactionsInsightful: p.reactionsInsightful ?? null,
    reactionsFunny: p.reactionsFunny ?? null,
    comments: p.comments ?? 0,
    reposts: p.reposts ?? 0,
    saves: p.saves ?? 0,
    sends: p.sends ?? 0,
    linkClicks: p.linkClicks ?? null,
    profileViewers: p.profileViewers ?? 0,
    followersGained: p.followersGained ?? 0,
    // Video metrics — null when absent so "no data" vs "genuinely zero"
    // stays distinguishable downstream (image-only posts will never have
    // these, and should read as "no video", not "0 views").
    videoViews: p.videoViews ?? null,
    watchTimeSeconds: p.watchTimeSeconds ?? null,
    averageWatchTimeSeconds: p.averageWatchTimeSeconds ?? null,
    engagementRate: engagementRate.toFixed(4),
    dataSource: 'voyager',
  };
}
