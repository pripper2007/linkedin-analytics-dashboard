// Pure function that distills everything Claude needs about a post
// (content + metrics + cohort baseline + percentile rank in the pool)
// into a single typed object. Both the heuristic interpretive cards on
// /posts/[id] and the LLM analyze-post route consume the same shape so
// they can't drift.
//
// No DB calls in here — caller passes in (post, allPosts). Pure logic
// only, easy to unit-test.

import type { Post } from '@/lib/types';

export interface AnalysisContext {
  post: Post;
  /** Stable summary of how this post compares to the captured pool. */
  poolBaseline: {
    /** Number of posts in the comparison pool (passed-in length). */
    size: number;
    avgImpressions: number;
    avgEngagementRate: number;
    avgFollowersGained: number;
    avgReactions: number;
    avgComments: number;
  };
  percentiles: {
    impressions: number;
    engagementRate: number;
    followersGained: number;
  };
  cohort: {
    /** "Payments Infrastructure, with image, with question, with bullets" */
    description: string;
    size: number;
    medianImpressions: number;
    /** post.impressions / medianImpressions — 1.0 = match cohort. */
    impressionsRatio: number;
  } | null;
}

export function describeCohort(post: Post): string {
  const bits: string[] = [post.topic];
  if (post.has_image) bits.push('with image');
  else bits.push('no image');
  if (post.has_question) bits.push('with question');
  if (post.has_bullet_points) bits.push('with bullets');
  return bits.join(', ');
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Percentile of `value` within `xs` (0-100). 50 returned for empty
 *  arrays so callers don't have to special-case the cold-start case. */
function percentile(xs: number[], value: number): number {
  if (xs.length === 0) return 50;
  let below = 0;
  for (const x of xs) if (x < value) below++;
  return (below / xs.length) * 100;
}

/**
 * Assemble the context. `pool` should be the full captured-post set
 * (same one /posts/[id] passes to its heuristic insights).
 */
export function buildAnalysisContext(
  post: Post,
  pool: Post[],
): AnalysisContext {
  // Restrict the pool to posts that actually have impressions captured —
  // matches the convention in calculatePostMetrics() / the heuristic
  // cards. Comparing this post against zero-impression placeholder rows
  // would skew percentiles toward the bottom.
  const captured = pool.filter((p) => p.impressions > 0);

  const poolBaseline = {
    size: captured.length,
    avgImpressions: Math.round(mean(captured.map((p) => p.impressions))),
    avgEngagementRate:
      Math.round(mean(captured.map((p) => p.engagement_rate)) * 100) / 100,
    avgFollowersGained: Math.round(
      mean(captured.map((p) => p.followers_gained)),
    ),
    avgReactions: Math.round(mean(captured.map((p) => p.reactions))),
    avgComments: Math.round(mean(captured.map((p) => p.comments))),
  };

  const percentiles = {
    impressions: Math.round(
      percentile(
        captured.map((p) => p.impressions),
        post.impressions,
      ),
    ),
    engagementRate: Math.round(
      percentile(
        captured.map((p) => p.engagement_rate),
        post.engagement_rate,
      ),
    ),
    followersGained: Math.round(
      percentile(
        captured.map((p) => p.followers_gained),
        post.followers_gained,
      ),
    ),
  };

  // Cohort: same topic + same image / question / bullet flags. Mirrors
  // the heuristic-cards definition so users see consistent framing.
  const cohortMembers = captured.filter(
    (p) =>
      p.activity_id !== post.activity_id &&
      p.topic === post.topic &&
      p.has_image === post.has_image &&
      p.has_question === post.has_question &&
      p.has_bullet_points === post.has_bullet_points,
  );
  const cohort =
    cohortMembers.length >= 3
      ? {
          description: describeCohort(post),
          size: cohortMembers.length,
          medianImpressions: Math.round(
            median(cohortMembers.map((p) => p.impressions)),
          ),
          impressionsRatio:
            median(cohortMembers.map((p) => p.impressions)) > 0
              ? Math.round(
                  (post.impressions /
                    median(cohortMembers.map((p) => p.impressions))) *
                    100,
                ) / 100
              : 0,
        }
      : null;

  return { post, poolBaseline, percentiles, cohort };
}
