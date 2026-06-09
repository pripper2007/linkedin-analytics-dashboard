import { describe, it, expect } from 'vitest';
import type { Post } from '@/lib/types';
import { buildAnalysisContext, describeCohort } from './build-context';

function mkPost(overrides: Partial<Post> = {}): Post {
  return {
    activity_id: 'a1',
    post_content: 'hi',
    post_date: '5/3/2026',
    publish_time: '10:00 AM',
    post_url: 'https://x',
    has_link: false,
    has_image: false,
    has_bold_unicode: false,
    has_emoji: false,
    has_bullet_points: false,
    has_question: false,
    word_count: 100,
    paragraph_count: 1,
    feature_count: 0,
    topic: 'Strategy',
    style: 'thought-leadership',
    impressions: 1000,
    members_reached: 800,
    engagement_rate: 5.0,
    reactions: 30,
    comments: 5,
    reposts: 1,
    saves: 2,
    sends: 0,
    profile_viewers: 10,
    followers_gained: 4,
    image_type: 'no_image',
    data_source: 'voyager',
    ...overrides,
  } as Post;
}

describe('buildAnalysisContext', () => {
  it('computes pool baseline excluding zero-impression posts', () => {
    const target = mkPost({ activity_id: 't', impressions: 1000 });
    const pool = [
      target,
      mkPost({ activity_id: 'a', impressions: 0 }), // excluded
      mkPost({ activity_id: 'b', impressions: 2000 }),
      mkPost({ activity_id: 'c', impressions: 3000 }),
    ];
    const ctx = buildAnalysisContext(target, pool);
    // 1000, 2000, 3000 → avg 2000
    expect(ctx.poolBaseline.size).toBe(3);
    expect(ctx.poolBaseline.avgImpressions).toBe(2000);
  });

  it('computes percentiles', () => {
    const target = mkPost({ activity_id: 't', impressions: 100 });
    const pool = [
      target,
      mkPost({ activity_id: '1', impressions: 50 }),
      mkPost({ activity_id: '2', impressions: 200 }),
      mkPost({ activity_id: '3', impressions: 300 }),
    ];
    const ctx = buildAnalysisContext(target, pool);
    // target=100; below it: only 50 (1 of 4) → 25%
    expect(ctx.percentiles.impressions).toBe(25);
  });

  it('returns null cohort when fewer than 3 matches', () => {
    const target = mkPost({
      activity_id: 't',
      topic: 'Strategy',
      has_image: true,
      has_question: true,
      has_bullet_points: false,
      impressions: 1000,
    });
    const pool = [
      target,
      mkPost({
        activity_id: 'm1',
        topic: 'Strategy',
        has_image: true,
        has_question: true,
        has_bullet_points: false,
        impressions: 800,
      }),
      mkPost({
        activity_id: 'm2',
        topic: 'Strategy',
        has_image: true,
        has_question: true,
        has_bullet_points: false,
        impressions: 1200,
      }),
    ];
    const ctx = buildAnalysisContext(target, pool);
    // Only 2 cohort matches (excluding target itself) → null.
    expect(ctx.cohort).toBeNull();
  });

  it('builds cohort summary when 3+ matches', () => {
    const target = mkPost({
      activity_id: 't',
      topic: 'Strategy',
      has_image: true,
      has_question: true,
      has_bullet_points: false,
      impressions: 1500,
    });
    const cohortMembers = [1, 2, 3, 4].map((i) =>
      mkPost({
        activity_id: `m${i}`,
        topic: 'Strategy',
        has_image: true,
        has_question: true,
        has_bullet_points: false,
        impressions: i * 1000,
      }),
    );
    const ctx = buildAnalysisContext(target, [target, ...cohortMembers]);
    expect(ctx.cohort).not.toBeNull();
    expect(ctx.cohort!.size).toBe(4);
    // Cohort impressions: 1000, 2000, 3000, 4000 → median 2500
    expect(ctx.cohort!.medianImpressions).toBe(2500);
    // Ratio: 1500 / 2500 = 0.6
    expect(ctx.cohort!.impressionsRatio).toBeCloseTo(0.6, 1);
  });

  it('describeCohort lists topic + visible features', () => {
    const post = mkPost({
      topic: 'Payments Infrastructure',
      has_image: true,
      has_question: true,
      has_bullet_points: false,
    });
    expect(describeCohort(post)).toBe(
      'Payments Infrastructure, with image, with question',
    );
  });
});
