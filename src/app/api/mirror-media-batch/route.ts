// POST /api/mirror-media-batch — walk every post_media row whose
// blob_url is NULL and mirror each one to Vercel Blob in sequence.
// Used by the /data-health page's "Mirror to Blob" button so the user
// doesn't need to run scripts/mirror-existing-media.ts in a terminal.
//
// Auth: same X-Ingest-Secret header as /api/ingest.
//
// Body: optional { limit?: number } — caps the number of rows mirrored
// in a single call (defaults to 100). Vercel Function timeout is 300s
// on the current plan; at ~250ms per mirror, 100 rows = 25s wall time
// which is well under that.
//
// Response:
//   { ok: true, mirrored: 12, alreadyMirrored: 0, failed: 2,
//     remaining: 4, failures: [{ activityId, sourceUrl, reason }] }

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { isAuthorizedRequest } from '../ingest/auth';
import { mirrorOne } from '@/lib/mirror-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cap at 5 minutes — matches Fluid Compute default; well above the
// ~30s a 100-row batch should take.
export const maxDuration = 300;

const bodySchema = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
  })
  .partial()
  .strict();

const RATE_LIMIT_MS = 250;

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Body is optional; tolerate empty/no JSON.
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const limit = parsed.data.limit ?? 100;

  const targets = (await db.execute(sql`
    SELECT activity_id, source_url
    FROM post_media
    WHERE blob_url IS NULL
    ORDER BY uploaded_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ activity_id: string; source_url: string }>;

  let mirrored = 0;
  let alreadyMirrored = 0;
  let failed = 0;
  const failures: Array<{
    activityId: string;
    sourceUrl: string;
    reason: string;
  }> = [];

  for (const row of targets) {
    const result = await mirrorOne(row.activity_id, row.source_url);
    if (result.status === 'mirrored') mirrored++;
    else if (result.status === 'already-mirrored') alreadyMirrored++;
    else {
      failed++;
      failures.push({
        activityId: row.activity_id,
        sourceUrl: row.source_url,
        reason:
          result.status === 'cdn-error'
            ? `cdn_error_${result.httpStatus}`
            : result.status === 'fetch-failed'
              ? `fetch_failed: ${result.detail.slice(0, 200)}`
              : result.status,
      });
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  // Re-count remaining NULLs so the UI can decide whether another
  // batch is needed.
  const [{ remaining }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS remaining FROM post_media WHERE blob_url IS NULL
  `)) as unknown as Array<{ remaining: number }>;

  return NextResponse.json({
    ok: true,
    mirrored,
    alreadyMirrored,
    failed,
    remaining,
    failures: failures.slice(0, 20),
  });
}
