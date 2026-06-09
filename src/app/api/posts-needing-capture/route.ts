// GET /api/posts-needing-capture — returns activity IDs the orchestrator
// should visit next.
//
// Auth: same X-Ingest-Secret header as /api/ingest.
//
// Response:
//   { activityIds: string[] }
//
// Criteria for inclusion (kept simple for Phase 3d.D initial backfill):
//   1. Posted within the last 24 months (LinkedIn analytics retention).
//   2. URL must reference an `activity` URN (first-party post). Posts
//      with `urn:li:share` or `urn:li:ugcPost` URLs are reshares / UGC
//      that LinkedIn does NOT expose a post-summary page for —
//      requesting their analytics page 404s and (worse) starts tripping
//      the orchestrator's "Trouble Loading" circuit-breaker. Confirmed
//      empirically: all 87 never-captured posts in the DB were of this
//      type and all 404 in a regular browser. Filtering them here keeps
//      the orchestrator focused on genuinely capturable posts.
//   3. Skip posts we already captured today (snapshot_date = today
//      with any non-zero reach signal — impressions or members_reached).
//      Tightened from the older "saves/sends/profile_viewers/followers
//      _gained > 0" predicate, which falsely re-queued any low-niche-
//      action post that had real impressions but happened to score 0
//      on every post-summary action — those are valid captures, just
//      from posts that don't drive saves or follower gains.
//
// Sort order: never-captured posts FIRST (ascending by the "has any
// snapshot" boolean, so `false` < `true` in Postgres), then by
// posted_at DESC inside each bucket. This stops fresh backfill runs
// from endlessly refreshing recent posts while older-never-captured
// ones wait at the back of the queue.

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { isAuthorized, INGEST_SECRET_HEADER } from '../ingest/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

export async function GET(request: Request): Promise<NextResponse> {
  const secret = request.headers.get(INGEST_SECRET_HEADER);
  if (!isAuthorized(secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limitParam = new URL(request.url).searchParams.get('limit');
  const requested = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number.isFinite(requested) ? requested : DEFAULT_LIMIT),
  );

  const rows = (await db.execute(sql`
    SELECT p.activity_id
    FROM posts p
    WHERE p.posted_at >= now() - interval '24 months'
      AND p.post_url NOT ILIKE '%urn%3Ali%3Ashare%'
      AND p.post_url NOT ILIKE '%urn%3Ali%3AugcPost%'
      AND NOT EXISTS (
        SELECT 1 FROM post_snapshots ps
        WHERE ps.activity_id = p.activity_id
          AND ps.snapshot_date = CURRENT_DATE
          AND (
            COALESCE(ps.impressions, 0) > 0
            OR COALESCE(ps.members_reached, 0) > 0
          )
      )
    ORDER BY
      -- A snapshot only counts as "captured" if it has a real reach
      -- signal. impressions=0 means partial parse (engagement row caught,
      -- top-card missed) — the post should re-enter the high-priority
      -- bucket for retry, not be treated as done.
      EXISTS (
        SELECT 1 FROM post_snapshots s
        WHERE s.activity_id = p.activity_id
          AND s.impressions > 0
      ) ASC,
      p.posted_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ activity_id: string }>;

  return NextResponse.json({
    activityIds: rows.map((r) => r.activity_id),
    count: rows.length,
    limit,
  });
}
