// GET /api/posts-needing-id-resolve — returns posts whose activity_id
// is actually a LEGACY share or ugcPost URN number (from the original
// JSON seed) rather than a true urn:li:activity URN. We need these
// resolved to their real activity URNs before the backfill orchestrator
// can capture their analytics — LinkedIn's post-summary page 404s for
// share/ugcPost IDs but serves real analytics for the underlying
// activity.
//
// Criteria: post_url matches `urn:li:share:*` or `urn:li:ugcPost:*`
// (URL-encoded form as LinkedIn serializes them).
//
// Auth: same X-Ingest-Secret header as /api/ingest.
// Response: { activityIds: string[], urlsByActivityId: Record<string, string> }

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { isAuthorized, INGEST_SECRET_HEADER } from '../ingest/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const secret = request.headers.get(INGEST_SECRET_HEADER);
  if (!isAuthorized(secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Skip posts whose resolution was already attempted recently — the
  // alarm chain would otherwise infinite-loop on posts that are
  // deleted / auth-walled / otherwise unresolvable. 24h cooldown lets
  // us retry eventually in case the page becomes accessible again.
  const rows = (await db.execute(sql`
    SELECT activity_id, post_url
    FROM posts
    WHERE (
      post_url ILIKE '%urn%3Ali%3Ashare%'
      OR post_url ILIKE '%urn%3Ali%3AugcPost%'
    )
    AND (
      id_resolve_attempted_at IS NULL
      OR id_resolve_attempted_at < NOW() - INTERVAL '24 hours'
    )
    ORDER BY posted_at DESC
  `)) as unknown as Array<{ activity_id: string; post_url: string }>;

  // Decode %3A → ':' on the way out. Chrome's URL bar normalizes either
  // form but earlier extension work surfaced edge cases where tabs
  // opened programmatically kept the encoded form through the entire
  // content-script lifecycle — safer to hand out the clean form.
  const urlsByActivityId: Record<string, string> = {};
  for (const r of rows) {
    try {
      urlsByActivityId[r.activity_id] = decodeURIComponent(r.post_url);
    } catch {
      urlsByActivityId[r.activity_id] = r.post_url;
    }
  }

  return NextResponse.json({
    activityIds: rows.map((r) => r.activity_id),
    urlsByActivityId,
    count: rows.length,
  });
}
