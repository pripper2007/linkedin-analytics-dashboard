// Unit tests for the ingest Zod schema.
// Focus: accept a representative valid payload, reject the common ways the
// extension could get it wrong.

import { describe, it, expect } from 'vitest';
import { ingestPayloadSchema } from './schema';
import {
  computeEngagementRate,
  computeSocialEngagements,
  hasMeaningfulMetrics,
  hasPostMetadata,
  toSnapshotInsert,
} from './mappers';

// Build a valid payload fixture — tests mutate shallow copies of this.
const validPost = {
  activityId: '7445950871907078144',
  postContent: 'hello world',
  postUrl: 'https://linkedin.com/posts/example',
  postedAt: '2026-04-03T21:50:00.000Z',
  snapshotDate: '2026-04-18',
  impressions: 1000,
  reactionsTotal: 10,
  comments: 2,
};

const validPayload = {
  capturedAt: '2026-04-18T10:30:00.000Z',
  source: 'extension-v1',
  posts: [validPost],
};

describe('ingestPayloadSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = ingestPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts a full payload with demographics and profile', () => {
    const full = {
      ...validPayload,
      posts: [
        {
          ...validPost,
          topic: 'AI',
          wordCount: 120,
          hasImage: true,
          reactionsLike: 6,
          reactionsCelebrate: 2,
          reactionsInsightful: 2,
          engagementRate: 1.6875,
          demographics: [
            { category: 'job_title', value: 'CEO', pct: 12.5, rank: 1 },
            { category: 'location', value: 'São Paulo', pct: 35, rank: 1 },
          ],
        },
      ],
      profile: {
        snapshotDate: '2026-04-18',
        totalFollowers: 10500,
        followerGrowth12mo: 3100,
      },
    };
    const result = ingestPayloadSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing required top-level fields', () => {
    const bad = { posts: [] };
    const result = ingestPayloadSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO capturedAt', () => {
    const bad = { ...validPayload, capturedAt: 'yesterday' };
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-YYYY-MM-DD snapshotDate', () => {
    const bad = {
      ...validPayload,
      posts: [{ ...validPost, snapshotDate: '4/18/2026' }],
    };
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative impression counts', () => {
    const bad = {
      ...validPayload,
      posts: [{ ...validPost, impressions: -5 }],
    };
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-URL postUrl', () => {
    const bad = {
      ...validPayload,
      posts: [{ ...validPost, postUrl: 'not-a-url' }],
    };
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown demographic category', () => {
    const bad = {
      ...validPayload,
      posts: [
        {
          ...validPost,
          demographics: [
            { category: 'zodiac_sign', value: 'Libra', pct: 10, rank: 1 },
          ],
        },
      ],
    };
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a pct outside [0, 100]', () => {
    const bad = {
      ...validPayload,
      posts: [
        {
          ...validPost,
          demographics: [
            { category: 'job_title', value: 'CEO', pct: 120, rank: 1 },
          ],
        },
      ],
    };
    expect(ingestPayloadSchema.safeParse(bad).success).toBe(false);
  });
});

// -------------------------------------------------------------------------
// toSnapshotInsert — the in-route mapper from validated payload → DB row.
// -------------------------------------------------------------------------
describe('toSnapshotInsert', () => {
  it('fills missing optional counts with 0 and reactions with null', () => {
    const parsed = ingestPayloadSchema.parse(validPayload);
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.impressions).toBe(1000);
    expect(row.reactionsTotal).toBe(10);
    expect(row.reposts).toBe(0);
    expect(row.reactionsLike).toBeNull();
    expect(row.dataSource).toBe('voyager');
  });

  it('computes social_engagements and engagement_rate from components', () => {
    // validPayload has impressions=1000, reactionsTotal=10, comments=2.
    // social_engagements = 10 + 2 + 0 + 0 + 0 = 12
    // engagement_rate    = 12 / 1000 * 100 = 1.2
    const parsed = ingestPayloadSchema.parse(validPayload);
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.socialEngagements).toBe(12);
    expect(row.engagementRate).toBe('1.2000');
  });

  it('prefers an explicit engagementRate from the payload (seed path)', () => {
    // The legacy seed path passes LinkedIn's own engagementRate which we
    // trust over our own computation. Simulates that case.
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [{ ...validPost, engagementRate: 1.6875 }],
    });
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.engagementRate).toBe('1.6875');
  });

  it('returns 0 engagement rate when impressions is 0', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [{ ...validPost, impressions: 0, reactionsTotal: 5 }],
    });
    const row = toSnapshotInsert(parsed.posts[0]);
    // Avoid /0; report 0% rather than null so sort-by-ER works on every row.
    expect(row.engagementRate).toBe('0.0000');
    expect(row.socialEngagements).toBe(5 + 2); // reactions + comments from validPost
  });

  it('leaves video metrics null when absent (image-only post)', () => {
    const parsed = ingestPayloadSchema.parse(validPayload);
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.videoViews).toBeNull();
    expect(row.watchTimeSeconds).toBeNull();
    expect(row.averageWatchTimeSeconds).toBeNull();
  });

  it('sums all five interaction types into social_engagements', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [
        {
          ...validPost,
          reactionsTotal: 100,
          comments: 20,
          reposts: 5,
          saves: 8,
          sends: 3,
        },
      ],
    });
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.socialEngagements).toBe(136); // 100 + 20 + 5 + 8 + 3
  });

  it('forwards video metrics when the ingest payload carries them', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [
        {
          ...validPost,
          videoViews: 453,
          watchTimeSeconds: 5340,
          averageWatchTimeSeconds: 11,
        },
      ],
    });
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.videoViews).toBe(453);
    expect(row.watchTimeSeconds).toBe(5340);
    expect(row.averageWatchTimeSeconds).toBe(11);
  });
});

// -------------------------------------------------------------------------
// Pure helpers for the engagement math.
// -------------------------------------------------------------------------
describe('computeSocialEngagements', () => {
  it('sums the five LinkedIn interaction types, treating missing as 0', () => {
    expect(
      computeSocialEngagements({
        reactionsTotal: 44,
        comments: 1,
        reposts: 0,
        saves: 2,
        sends: 0,
      }),
    ).toBe(47);
  });
  it('returns 0 when all components are null/undefined', () => {
    expect(computeSocialEngagements({})).toBe(0);
  });
});

describe('computeEngagementRate', () => {
  it('expresses engagements per impression as a percent to 4 decimals', () => {
    expect(computeEngagementRate(47, 1331)).toBeCloseTo(3.5312, 4);
  });
  it('returns 0 when impressions is 0 (avoid /0)', () => {
    expect(computeEngagementRate(47, 0)).toBe(0);
    expect(computeEngagementRate(0, 0)).toBe(0);
  });
  it('returns 0 when engagements is 0 and impressions > 0', () => {
    expect(computeEngagementRate(0, 100)).toBe(0);
  });
});

// -------------------------------------------------------------------------
// hasMeaningfulMetrics — guard that prevents the voyager feed ingest from
// stomping over official analytics snapshots with all-zero rows.
// -------------------------------------------------------------------------
describe('hasMeaningfulMetrics', () => {
  it('returns false when impressions, reactions, and comments are all zero', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [
        { ...validPost, impressions: 0, reactionsTotal: 0, comments: 0 },
      ],
    });
    expect(hasMeaningfulMetrics(parsed.posts[0])).toBe(false);
  });

  it('returns true when the post has reach (impressions or membersReached)', () => {
    const base = { ...validPost, impressions: 0, reactionsTotal: 0, comments: 0 };
    for (const override of [{ impressions: 1 }, { membersReached: 1 }]) {
      const parsed = ingestPayloadSchema.parse({
        ...validPayload,
        posts: [{ ...base, ...override }],
      });
      expect(hasMeaningfulMetrics(parsed.posts[0])).toBe(true);
    }
  });

  it('returns false with engagement but no reach (avoids stomping official rows)', () => {
    // A capture with reactions/comments but zero impressions AND zero
    // membersReached is treated as not-yet-meaningful: the ingest route
    // skips it so a partial capture can't overwrite an official snapshot.
    for (const override of [{ reactionsTotal: 1 }, { comments: 1 }]) {
      const parsed = ingestPayloadSchema.parse({
        ...validPayload,
        posts: [
          {
            ...validPost,
            impressions: 0,
            membersReached: 0,
            reactionsTotal: 0,
            comments: 0,
            ...override,
          },
        ],
      });
      expect(hasMeaningfulMetrics(parsed.posts[0])).toBe(false);
    }
  });

  it('returns true for a typical captured post', () => {
    const parsed = ingestPayloadSchema.parse(validPayload);
    expect(hasMeaningfulMetrics(parsed.posts[0])).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Post-summary (metadata-free) captures — Phase 3d.B accepts payloads that
// carry only activityId + metrics. The feed path still sends full metadata;
// both coexist in the same ingest route.
// -------------------------------------------------------------------------
describe('snapshot-only ingest (post-summary capture)', () => {
  // Minimal valid post-summary payload: activityId + snapshotDate +
  // impressions (the one required metric), no metadata.
  const summaryOnlyPost = {
    activityId: '7451004062705119233',
    snapshotDate: '2026-04-18',
    impressions: 1311,
    saves: 2,
    sends: 0,
    profileViewers: 2,
    followersGained: 1,
    videoViews: 453,
    watchTimeSeconds: 5340,
  };

  it('accepts a metadata-free payload', () => {
    const result = ingestPayloadSchema.safeParse({
      ...validPayload,
      posts: [summaryOnlyPost],
    });
    expect(result.success).toBe(true);
  });

  it('hasPostMetadata returns false for metadata-free posts', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [summaryOnlyPost],
    });
    expect(hasPostMetadata(parsed.posts[0])).toBe(false);
  });

  it('hasPostMetadata returns true for the feed-capture shape', () => {
    const parsed = ingestPayloadSchema.parse(validPayload);
    expect(hasPostMetadata(parsed.posts[0])).toBe(true);
  });

  it('toSnapshotInsert works with all post-summary fields present', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [summaryOnlyPost],
    });
    const row = toSnapshotInsert(parsed.posts[0]);
    expect(row.impressions).toBe(1311);
    expect(row.saves).toBe(2);
    expect(row.sends).toBe(0);
    expect(row.profileViewers).toBe(2);
    expect(row.followersGained).toBe(1);
    expect(row.videoViews).toBe(453);
    expect(row.watchTimeSeconds).toBe(5340);
    // reactionsTotal defaults to 0 when absent (post-summary doesn't
    // break out reaction counts — the feed path fills those in).
    expect(row.reactionsTotal).toBe(0);
    expect(row.comments).toBe(0);
  });

  it('hasMeaningfulMetrics uses impressions even when reactions are absent', () => {
    const parsed = ingestPayloadSchema.parse({
      ...validPayload,
      posts: [summaryOnlyPost],
    });
    expect(hasMeaningfulMetrics(parsed.posts[0])).toBe(true);
  });
});
