// Unit tests for the Voyager parser. Fixtures mirror the normalized
// Rest.li shape observed in real voyagerFeedDashProfileUpdates responses
// (see docs/voyager-recon.md).

import { describe, it, expect } from 'vitest';
import {
  parseFeedDashProfileUpdates,
  parseReactionTypeCounts,
  parseMedia,
  activityIdToIso,
  isFeedDashProfileUpdatesUrl,
} from './voyager-parser';

// -------------------------------------------------------------------------
// activityIdToIso
// -------------------------------------------------------------------------
describe('activityIdToIso', () => {
  it('decodes a known activity ID to the expected timestamp', () => {
    expect(activityIdToIso('7451004062705119233')).toBe(
      '2026-04-17T20:30:01.510Z',
    );
  });

  it('produces deterministic output', () => {
    const iso = activityIdToIso('7445950871907078144');
    expect(iso.startsWith('2026-04-')).toBe(true);
  });
});

// -------------------------------------------------------------------------
// parseReactionTypeCounts
// -------------------------------------------------------------------------
describe('parseReactionTypeCounts', () => {
  it('maps LinkedIn enum names to our reaction columns', () => {
    const result = parseReactionTypeCounts([
      { reactionType: 'LIKE', count: 30 },
      { reactionType: 'PRAISE', count: 5 },
      { reactionType: 'EMPATHY', count: 2 },
      { reactionType: 'APPRECIATION', count: 1 },
      { reactionType: 'INTEREST', count: 4 },
      { reactionType: 'ENTERTAINMENT', count: 1 },
    ]);
    expect(result).toEqual({
      reactionsLike: 30,
      reactionsCelebrate: 5,
      reactionsSupport: 2,
      reactionsLove: 1,
      reactionsInsightful: 4,
      reactionsFunny: 1,
    });
  });

  it('seeds missing types to 0 when the array is present', () => {
    const result = parseReactionTypeCounts([
      { reactionType: 'LIKE', count: 34 },
      { reactionType: 'PRAISE', count: 3 },
    ]);
    expect(result).toEqual({
      reactionsLike: 34,
      reactionsCelebrate: 3,
      reactionsSupport: 0,
      reactionsLove: 0,
      reactionsInsightful: 0,
      reactionsFunny: 0,
    });
  });

  it('returns {} when reactionTypeCounts is not an array', () => {
    expect(parseReactionTypeCounts(undefined)).toEqual({});
    expect(parseReactionTypeCounts(null)).toEqual({});
    expect(parseReactionTypeCounts({})).toEqual({});
  });

  it('ignores legacy / unknown types', () => {
    const result = parseReactionTypeCounts([
      { reactionType: 'LIKE', count: 10 },
      { reactionType: 'MAYBE', count: 3 },
      { reactionType: 'SOMETHING_NEW', count: 2 },
    ]);
    expect(result.reactionsLike).toBe(10);
  });
});

// -------------------------------------------------------------------------
// parseMedia — content-shape tests (unchanged; content isn't normalized)
// -------------------------------------------------------------------------
describe('parseMedia', () => {
  it('extracts inline video streams + thumbnail', () => {
    const content = {
      linkedInVideoComponent: {
        videoPlayMetadata: {
          progressiveStreams: [
            { streamingLocations: [{ url: 'https://example.com/vid-720.mp4' }] },
          ],
          thumbnail: { rootUrl: 'https://example.com/thumb.jpg' },
        },
      },
    };
    expect(parseMedia(content)).toEqual([
      { kind: 'video', sourceUrl: 'https://example.com/vid-720.mp4' },
      { kind: 'video_thumbnail', sourceUrl: 'https://example.com/thumb.jpg' },
    ]);
  });

  it('returns [] for content without known components', () => {
    expect(parseMedia(null)).toEqual([]);
    expect(parseMedia({})).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// parseFeedDashProfileUpdates — normalized-format end-to-end
// -------------------------------------------------------------------------
//
// Helper to build a realistic-looking response fixture.
function makeResponse(opts: {
  updates: Array<{
    activityId: string;
    ugcId: string;
    commentary?: string;
    shareUrl?: string;
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    reactionTypeCounts?: Array<{ reactionType: string; count: number }>;
    content?: unknown;
  }>;
}) {
  const elements: string[] = [];
  const included: unknown[] = [];

  for (const u of opts.updates) {
    const updateUrn = `urn:li:fsd_update:(urn:li:activity:${u.activityId},MEMBER_SHARES,DEBUG_REASON,DEFAULT,false)`;
    const shareUrn = `urn:li:ugcPost:${u.ugcId}`;
    elements.push(updateUrn);

    // Update entity
    included.push({
      $type: 'com.linkedin.voyager.dash.feed.Update',
      entityUrn: updateUrn,
      metadata: {
        backendUrn: `urn:li:activity:${u.activityId}`,
        shareUrn,
      },
      commentary:
        u.commentary !== undefined ? { text: { text: u.commentary } } : null,
      socialContent: u.shareUrl ? { shareUrl: u.shareUrl } : null,
      content: u.content ?? null,
    });

    // SocialActivityCounts entity (keyed by fsd_socialActivityCounts:<shareUrn>)
    included.push({
      $type: 'com.linkedin.voyager.dash.feed.SocialActivityCounts',
      entityUrn: `urn:li:fsd_socialActivityCounts:${shareUrn}`,
      numImpressions: u.impressions ?? 0,
      numLikes: u.likes ?? 0,
      numComments: u.comments ?? 0,
      numShares: u.shares ?? 0,
      reactionTypeCounts: u.reactionTypeCounts,
    });
  }

  return {
    data: {
      data: {
        feedDashProfileUpdatesByMemberShareFeed: {
          '*elements': elements,
          metadata: { paginationToken: 'token' },
          paging: { count: elements.length, start: 0, total: 0 },
        },
      },
    },
    included,
    meta: {},
  };
}

describe('parseFeedDashProfileUpdates (normalized)', () => {
  it('parses a single video post with full metrics', () => {
    const response = makeResponse({
      updates: [
        {
          activityId: '7451004062705119233',
          ugcId: '7450674109228875776',
          commentary: 'Quantas tipos de Pix…',
          shareUrl: 'https://www.linkedin.com/posts/pedroripper_pix',
          impressions: 1096,
          likes: 37,
          comments: 1,
          shares: 0,
          reactionTypeCounts: [
            { reactionType: 'LIKE', count: 34 },
            { reactionType: 'PRAISE', count: 3 },
          ],
          content: {
            linkedInVideoComponent: {
              videoPlayMetadata: {
                progressiveStreams: [
                  { streamingLocations: [{ url: 'https://e.com/v.mp4' }] },
                ],
                thumbnail: { rootUrl: 'https://e.com/t.jpg' },
              },
            },
          },
        },
      ],
    });

    const posts = parseFeedDashProfileUpdates(response);
    expect(posts).toHaveLength(1);
    const [p] = posts;
    expect(p.activityId).toBe('7451004062705119233');
    expect(p.postedAt).toBe('2026-04-17T20:30:01.510Z');
    expect(p.postContent).toBe('Quantas tipos de Pix…');
    expect(p.postUrl).toBe('https://www.linkedin.com/posts/pedroripper_pix');
    expect(p.impressions).toBe(1096);
    expect(p.reactionsTotal).toBe(37);
    expect(p.reactionsLike).toBe(34);
    expect(p.reactionsCelebrate).toBe(3);
    expect(p.reactionsSupport).toBe(0);
    expect(p.reactionsFunny).toBe(0);
    expect(p.comments).toBe(1);
    expect(p.reposts).toBe(0);
    expect(p.media).toEqual([
      { kind: 'video', sourceUrl: 'https://e.com/v.mp4' },
      { kind: 'video_thumbnail', sourceUrl: 'https://e.com/t.jpg' },
    ]);
  });

  it('parses multiple posts from one response', () => {
    const response = makeResponse({
      updates: [
        { activityId: '7451004062705119233', ugcId: '7450674109228875776', likes: 1 },
        { activityId: '7440512413369622528', ugcId: '7440100000000000000', likes: 2 },
      ],
    });
    const posts = parseFeedDashProfileUpdates(response);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.reactionsTotal)).toEqual([1, 2]);
  });

  it('falls back to a computed post URL when shareUrl is absent', () => {
    const response = makeResponse({
      updates: [
        { activityId: '7451004062705119233', ugcId: '7450674109228875776' },
      ],
    });
    const [p] = parseFeedDashProfileUpdates(response);
    expect(p.postUrl).toBe(
      'https://www.linkedin.com/feed/update/urn:li:activity:7451004062705119233/',
    );
  });

  it('emits 0s for counts when the SocialActivityCounts entity is missing', () => {
    // Build a response with the Update but drop its counts entity.
    const response = makeResponse({
      updates: [
        { activityId: '7451004062705119233', ugcId: '7450674109228875776', likes: 5 },
      ],
    });
    response.included = response.included.filter(
      (e) => !(typeof e === 'object' && e !== null &&
        (e as Record<string, unknown>).$type ===
        'com.linkedin.voyager.dash.feed.SocialActivityCounts'),
    );
    const [p] = parseFeedDashProfileUpdates(response);
    expect(p.impressions).toBe(0);
    expect(p.reactionsTotal).toBe(0);
  });

  it('skips Update entities whose backendUrn is missing or malformed', () => {
    const response = makeResponse({
      updates: [
        { activityId: '7451004062705119233', ugcId: '7450674109228875776', likes: 1 },
      ],
    });
    // Corrupt the one Update's backendUrn.
    for (const e of response.included as Record<string, unknown>[]) {
      if (e.$type === 'com.linkedin.voyager.dash.feed.Update') {
        (e.metadata as Record<string, unknown>).backendUrn = 'not-a-urn';
      }
    }
    expect(parseFeedDashProfileUpdates(response)).toEqual([]);
  });

  it('ignores *elements URNs that do not resolve to Update entities', () => {
    const response = makeResponse({
      updates: [
        { activityId: '7451004062705119233', ugcId: '7450674109228875776', likes: 1 },
      ],
    });
    // Inject a dangling URN reference.
    response.data.data.feedDashProfileUpdatesByMemberShareFeed['*elements'].push(
      'urn:li:fsd_update:(urn:li:activity:9999999999999999999,X,Y,Z,false)',
    );
    const posts = parseFeedDashProfileUpdates(response);
    expect(posts).toHaveLength(1); // original post kept, dangling URN skipped
  });

  it('returns [] for unexpected top-level shapes', () => {
    expect(parseFeedDashProfileUpdates(null)).toEqual([]);
    expect(parseFeedDashProfileUpdates({})).toEqual([]);
    expect(parseFeedDashProfileUpdates({ data: {} })).toEqual([]);
    expect(parseFeedDashProfileUpdates({ data: { data: {} } })).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// isFeedDashProfileUpdatesUrl
// -------------------------------------------------------------------------
describe('isFeedDashProfileUpdatesUrl', () => {
  it('matches the documented voyager URL', () => {
    const url =
      'https://www.linkedin.com/voyager/api/graphql?includeWebMetadata=true&variables=(count:20,start:0)&queryId=voyagerFeedDashProfileUpdates.4af00b28d60ed0f1488018948daad822';
    expect(isFeedDashProfileUpdatesUrl(url)).toBe(true);
  });

  it('does not match other voyager queries', () => {
    expect(
      isFeedDashProfileUpdatesUrl(
        'https://www.linkedin.com/voyager/api/graphql?queryId=voyagerIdentityDashProfiles.9bdce5f8ad48e09bdef1f420fbaae9cc',
      ),
    ).toBe(false);
  });

  it('does not match non-voyager URLs', () => {
    expect(
      isFeedDashProfileUpdatesUrl(
        'https://www.linkedin.com/flagship-web/rsc-action/actions/server-request',
      ),
    ).toBe(false);
  });
});
