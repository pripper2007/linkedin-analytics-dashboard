// POST /api/mirror-media — server-side fetch of a LinkedIn CDN media
// URL into Vercel Blob, then update post_media.blob_url so the
// dashboard can serve a durable URL instead.
//
// Body: { activityId, sourceUrl }
// Auth: same X-Ingest-Secret header as /api/ingest.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAuthorized, INGEST_SECRET_HEADER } from '../ingest/auth';
import { mirrorOne } from '@/lib/mirror-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  activityId: z.string().regex(/^\d+$/, 'numeric activity ID'),
  sourceUrl: z.string().url(),
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
  const { activityId, sourceUrl } = parsed.data;

  const result = await mirrorOne(activityId, sourceUrl);
  switch (result.status) {
    case 'mirrored':
      return NextResponse.json({
        ok: true,
        action: 'mirrored',
        blobUrl: result.blobUrl,
        bytes: result.bytes,
      });
    case 'already-mirrored':
      return NextResponse.json({
        ok: true,
        action: 'already-mirrored',
        blobUrl: result.blobUrl,
      });
    case 'not-found':
      return NextResponse.json(
        { error: 'media_row_not_found' },
        { status: 404 },
      );
    case 'cdn-error':
      return NextResponse.json(
        { error: 'cdn_error', status: result.httpStatus },
        { status: 502 },
      );
    case 'fetch-failed':
      return NextResponse.json(
        { error: 'fetch_failed', detail: result.detail },
        { status: 502 },
      );
  }
}
