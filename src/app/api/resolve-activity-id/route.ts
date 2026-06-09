// POST /api/resolve-activity-id — remaps a legacy post (identified by
// its wrong `share`/`ugcPost`-derived activity_id) to its real
// `urn:li:activity:N` ID. Called by the extension's ID-resolver
// orchestrator once the content script has extracted the true URN
// from the post page's HTML.
//
// Request body:
//   { oldActivityId: string, newActivityId: string, newPostUrl: string }
//
// Logic:
//   1. If a row already exists with activity_id = newActivityId, the
//      extension captured it via feed earlier. Delete the stale legacy
//      row — we already have the richer version.
//   2. Otherwise UPDATE the legacy row to the correct activity_id
//      and canonical post_url.
//
// On conflict, snapshots/demographics don't need migration because
// the legacy-seeded posts never had snapshots (that's why we're
// fixing this). The unique (activity_id, snapshot_date) constraints
// on child tables would block any reconciliation anyway — deleting
// the legacy row is the only safe path.
//
// Auth: same X-Ingest-Secret header as /api/ingest.

import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { posts } from '@/db/schema';
import { isAuthorized, INGEST_SECRET_HEADER } from '../ingest/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  oldActivityId: z.string().regex(/^\d+$/, 'numeric activity ID only'),
  // Allow null to record a failed resolution attempt (the content
  // script couldn't find an activity URN on the page). Server marks
  // id_resolve_attempted_at so the queue endpoint excludes this row
  // from retries for 24h — prevents the alarm chain from looping on
  // unresolvable posts.
  newActivityId: z
    .union([z.string().regex(/^\d+$/, 'numeric activity ID only'), z.null()]),
  newPostUrl: z.string().url().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const secret = request.headers.get(INGEST_SECRET_HEADER);
  if (!isAuthorized(secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { oldActivityId, newActivityId, newPostUrl } = parsed.data;

  // Failed resolution — mark the row so the queue endpoint excludes
  // it from retries for 24h. Prevents the alarm chain from looping
  // on deleted/inaccessible posts.
  if (newActivityId === null) {
    await db
      .update(posts)
      .set({ idResolveAttemptedAt: new Date() })
      .where(eq(posts.activityId, oldActivityId));
    return NextResponse.json({ ok: true, action: 'marked-failed' });
  }

  // No-op: if old == new (caller was confused), don't do anything.
  if (oldActivityId === newActivityId) {
    return NextResponse.json({ ok: true, action: 'no-op' });
  }

  // Does the target (real) row already exist? If so, just delete the legacy.
  const existing = await db
    .select({ id: posts.activityId })
    .from(posts)
    .where(eq(posts.activityId, newActivityId))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(posts).where(eq(posts.activityId, oldActivityId));
    return NextResponse.json({ ok: true, action: 'merged' });
  }

  // Otherwise rename the legacy row in place.
  const canonicalUrl =
    newPostUrl ?? `https://www.linkedin.com/feed/update/urn:li:activity:${newActivityId}/`;

  const updated = await db
    .update(posts)
    .set({
      activityId: newActivityId,
      postUrl: canonicalUrl,
      lastUpdatedAt: new Date(),
    })
    .where(eq(posts.activityId, oldActivityId))
    .returning({ id: posts.activityId });

  if (updated.length === 0) {
    return NextResponse.json(
      { error: 'old_activity_not_found' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, action: 'renamed' });
}
