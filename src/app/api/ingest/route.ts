// POST /api/ingest — receives daily analytics batches from the personal
// browser extension and persists them to Supabase.
//
// Contract:
//   Auth   : X-Ingest-Secret header must match INGEST_SECRET env var.
//   Body   : JSON matching ingestPayloadSchema (see ./schema.ts).
//   Result : 200 { ok: true, summary: {...} } on success.
//            401 { error: 'unauthorized' } on bad secret.
//            400 { error: 'invalid_payload', issues: [...] } on Zod failure.
//            500 { error: 'ingest_failed' } on DB failure (logged).
//
// Every request opens and closes one row in the ingest_log table so the
// eventual /api/health endpoint can surface "last successful run at X".

import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { ingestLog, posts } from '@/db/schema';
import {
  upsertPostFromIngest,
  upsertPostSnapshot,
  upsertPostDemographic,
  upsertProfileSnapshot,
  replacePostMedia,
} from '@/db/upserts';

/**
 * LinkedIn activity IDs encode the post timestamp in the upper 41 bits
 * (ms since epoch). Derive a reasonable postedAt for shell rows we
 * create to satisfy the post_snapshots FK when metadata isn't in the
 * payload (post-summary scrape arrived ahead of feed capture).
 */
function activityIdToDate(activityId: string): Date {
  try {
    // eslint-disable-next-line no-undef
    const ms = Number(BigInt(activityId) >> BigInt(22));
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date() : d;
  } catch {
    return new Date();
  }
}

import { classifyPost } from '@/lib/post-classifier';
import {
  detectFeatures,
  countContentFeatures,
  countWordsAndParagraphs,
} from '@/lib/content-features';
import { isAuthorized, INGEST_SECRET_HEADER } from './auth';
import { mirrorOne } from '@/lib/mirror-media';
import {
  hasMeaningfulMetrics,
  hasPostMetadata,
  toSnapshotInsert,
} from './mappers';
import { ingestPayloadSchema, type IngestPayload } from './schema';

// Force Node runtime (postgres.js needs Node APIs; edge won't work).
export const runtime = 'nodejs';
// Never cache or prerender — this is a mutation endpoint.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  // -- 1. Auth --
  const secretHeader = request.headers.get(INGEST_SECRET_HEADER);
  if (!isAuthorized(secretHeader)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // -- 2. Parse + validate body --
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400 },
    );
  }

  const parsed = ingestPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // -- 3. Persist, with an ingest_log row bracketing the work --
  const [logRow] = await db
    .insert(ingestLog)
    .values({ status: 'success', source: parsed.data.source })
    .returning();

  try {
    const summary = await persistBatch(parsed.data);

    await db
      .update(ingestLog)
      .set({
        finishedAt: new Date(),
        status: 'success',
        postsCaptured: summary.posts,
      })
      .where(eq(ingestLog.id, logRow.id));

    // Bust the analytics cache so dashboard readers see fresh data on
    // their next page load instead of waiting up to 10 minutes for the
    // unstable_cache TTL. All read-side wrappers in src/lib/queries.ts
    // are tagged with 'analytics'.
    revalidateTag('analytics');

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingest] persist failed:', msg);

    await db
      .update(ingestLog)
      .set({
        finishedAt: new Date(),
        status: 'failure',
        errorMessage: msg,
      })
      .where(eq(ingestLog.id, logRow.id));

    return NextResponse.json({ error: 'ingest_failed' }, { status: 500 });
  }
}

// --- helpers ---------------------------------------------------------------

interface PersistSummary {
  posts: number;
  postMetadataUpserts: number;
  snapshots: number;
  skippedEmptySnapshots: number;
  demographics: number;
  profileSnapshots: number;
}

async function persistBatch(payload: IngestPayload): Promise<PersistSummary> {
  let demoCount = 0;
  let snapshotCount = 0;
  let skippedEmpty = 0;
  let metadataUpserts = 0;

  for (const p of payload.posts) {
    // Only upsert the posts row when the payload carries stable metadata
    // (content/URL/postedAt). Post-summary DOM captures added in
    // Phase 3d.B are snapshot-only — they assume the post row already
    // exists from a prior feed capture or legacy backfill. See
    // mappers.ts::hasPostMetadata.
    if (hasPostMetadata(p)) {
      // Auto-classify topic + style from post content if the payload
      // didn't specify either. The extension doesn't classify at capture
      // time; keyword rules live in src/lib/post-classifier.ts and run
      // here so every new post lands with a topic/style when possible.
      // upsertPostFromIngest preserves existing non-null values on conflict,
      // so a previously manual classification is never overwritten.
      const auto =
        !p.topic || !p.style
          ? classifyPost(p.postContent!)
          : { topic: null, style: null };

      // Auto-derive the 5 content feature flags from post_content — the
      // extension doesn't compute these. Payload values still win when
      // explicitly provided (extension might refine detection someday).
      // See src/lib/content-features.ts for the detection rules.
      const detected = detectFeatures(p.postContent!);
      const hasLink = p.hasLink ?? detected.hasLink;
      const hasEmoji = p.hasEmoji ?? detected.hasEmoji;
      const hasBulletPoints = p.hasBulletPoints ?? detected.hasBulletPoints;
      const hasQuestion = p.hasQuestion ?? detected.hasQuestion;
      const hasBoldUnicode = p.hasBoldUnicode ?? detected.hasBoldUnicode;
      // has_image: prefer explicit payload flag; else derive from media[]
      // (image / video_thumbnail kinds count as having a visual); else
      // legacy imageType string; else false. The extension currently
      // sends `media` but neither hasImage nor imageType, so the
      // media-derived path is what fires for live captures.
      const mediaHasImage =
        Array.isArray(p.media) &&
        p.media.some(
          (m) => m.kind === 'image' || m.kind === 'video_thumbnail',
        );
      const hasImage =
        p.hasImage ??
        (mediaHasImage ||
          (p.imageType ? p.imageType !== 'no_image' : false));

      // word_count / paragraph_count: extension doesn't compute these,
      // so we derive from postContent every time. Cheap and avoids the
      // null-rendering-as-zero bug on /posts/[id].
      const counted = countWordsAndParagraphs(p.postContent!);
      const wordCount = p.wordCount ?? counted.wordCount;
      const paragraphCount = p.paragraphCount ?? counted.paragraphCount;

      // featureCount = count of present flags (6 total incl. image)
      const featureCount =
        p.featureCount ??
        countContentFeatures({
          hasLink,
          hasEmoji,
          hasBulletPoints,
          hasQuestion,
          hasBoldUnicode,
        }) + (hasImage ? 1 : 0);

      await upsertPostFromIngest(db, {
        activityId: p.activityId,
        // The checks above narrow these three to defined strings.
        postContent: p.postContent!,
        postUrl: p.postUrl!,
        postedAt: new Date(p.postedAt!),
        topic: p.topic ?? auto.topic ?? null,
        style: p.style ?? auto.style ?? null,
        imageType: p.imageType ?? null,
        wordCount,
        paragraphCount,
        hasLink,
        hasImage,
        hasBoldUnicode,
        hasEmoji,
        hasBulletPoints,
        hasQuestion,
        featureCount,
      });
      metadataUpserts++;
    }

    // Only record a snapshot if the payload actually carries metrics.
    // See mappers.ts::hasMeaningfulMetrics for the rationale.
    if (hasMeaningfulMetrics(p)) {
      // When the payload is snapshot-only (post-summary scrape arrived
      // before the feed capture for this activity), there's no posts
      // row yet and the snapshot FK would fail. Insert a minimal shell
      // row first — a later feed capture or the ID resolver will fill
      // in the real content/URL through upsertPostFromIngest's
      // ON CONFLICT clause.
      if (!hasPostMetadata(p)) {
        await db
          .insert(posts)
          .values({
            activityId: p.activityId,
            postContent: '',
            postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${p.activityId}/`,
            postedAt: activityIdToDate(p.activityId),
          })
          .onConflictDoNothing();
      }
      await upsertPostSnapshot(db, toSnapshotInsert(p));
      snapshotCount++;
    } else {
      skippedEmpty++;
    }

    // Persist media (images / video URLs) when the payload carries it.
    // Storing the LinkedIn CDN sourceUrl directly; we then mirror to
    // Vercel Blob in-line so the dashboard always sees durable URLs
    // without the user having to click "Mirror N pending" on
    // /data-health. replacePostMedia already preserves blob_url for
    // unchanged source URLs; mirrorOne short-circuits on already-
    // mirrored rows. Failures are logged but never fail the ingest —
    // the next manual mirror sweep can retry.
    if (p.media && p.media.length > 0) {
      await replacePostMedia(
        db,
        p.activityId,
        p.media.map((m, i) => ({
          activityId: p.activityId,
          kind: m.kind,
          sourceUrl: m.sourceUrl,
          position: i,
          blobUrl: null,
        })),
      );
      for (const m of p.media) {
        try {
          await mirrorOne(p.activityId, m.sourceUrl);
        } catch (err) {
          console.error('[ingest auto-mirror]', p.activityId, err);
        }
      }
    }

    if (p.demographics) {
      for (const d of p.demographics) {
        await upsertPostDemographic(db, {
          activityId: p.activityId,
          snapshotDate: p.snapshotDate,
          category: d.category,
          value: d.value,
          pct: d.pct.toFixed(2),
          rank: d.rank,
        });
        demoCount++;
      }
    }
  }

  let profileSnapshots = 0;
  if (payload.profile) {
    await upsertProfileSnapshot(db, {
      snapshotDate: payload.profile.snapshotDate,
      totalFollowers: payload.profile.totalFollowers ?? null,
      totalConnections: payload.profile.totalConnections ?? null,
      followerGrowth12mo: payload.profile.followerGrowth12mo ?? null,
      totalImpressions12mo: payload.profile.totalImpressions12mo ?? null,
      totalEngagements12mo: payload.profile.totalEngagements12mo ?? null,
    });
    profileSnapshots = 1;
  }

  return {
    posts: payload.posts.length,
    postMetadataUpserts: metadataUpserts,
    snapshots: snapshotCount,
    skippedEmptySnapshots: skippedEmpty,
    demographics: demoCount,
    profileSnapshots,
  };
}

