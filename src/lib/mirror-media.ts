// Server-side helper to mirror one LinkedIn CDN media URL into Vercel
// Blob and update post_media.blob_url. Shared between
// /api/mirror-media (single row) and /api/mirror-media-batch (batch).

import { eq, and } from 'drizzle-orm';
import { put } from '@vercel/blob';

import { db } from '@/db/client';
import { postMedia } from '@/db/schema';

export type MirrorResult =
  | { status: 'mirrored'; blobUrl: string; bytes: number }
  | { status: 'already-mirrored'; blobUrl: string }
  | { status: 'not-found' }
  | { status: 'cdn-error'; httpStatus: number }
  | { status: 'fetch-failed'; detail: string };

export async function mirrorOne(
  activityId: string,
  sourceUrl: string,
): Promise<MirrorResult> {
  const rows = await db
    .select({
      id: postMedia.id,
      blobUrl: postMedia.blobUrl,
    })
    .from(postMedia)
    .where(
      and(
        eq(postMedia.activityId, activityId),
        eq(postMedia.sourceUrl, sourceUrl),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { status: 'not-found' };
  if (row.blobUrl) {
    return { status: 'already-mirrored', blobUrl: row.blobUrl };
  }

  let resp: Response;
  try {
    resp = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'linkedin-analytics-mirror/1.0' },
    });
  } catch (err) {
    return { status: 'fetch-failed', detail: String(err) };
  }
  if (!resp.ok) {
    return { status: 'cdn-error', httpStatus: resp.status };
  }
  const contentType =
    resp.headers.get('content-type') ?? 'application/octet-stream';
  const buf = Buffer.from(await resp.arrayBuffer());

  const ext = guessExtension(contentType, sourceUrl);
  const sourceHash = hashShort(sourceUrl);
  const pathname = `posts/${activityId}/${sourceHash}${ext}`;

  const { url } = await put(pathname, buf, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  await db
    .update(postMedia)
    .set({ blobUrl: url })
    .where(eq(postMedia.id, row.id));

  return { status: 'mirrored', blobUrl: url, bytes: buf.length };
}

function guessExtension(contentType: string, sourceUrl: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('jpeg')) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('mp4')) return '.mp4';
  const urlExt = /\.(jpe?g|png|gif|webp|mp4)(?:$|\?)/i.exec(sourceUrl);
  return urlExt ? `.${urlExt[1].toLowerCase()}` : '';
}

function hashShort(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
