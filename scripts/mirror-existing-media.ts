// One-shot migration: walk every post_media row whose blob_url is
// NULL, call /api/mirror-media to fetch the LinkedIn CDN URL and
// upload it to Vercel Blob. Updates blob_url in place.
//
// Idempotent — already-mirrored rows are skipped. Safe to re-run if
// some uploads fail (e.g. CDN expired URLs); only the still-NULL
// rows get retried.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/mirror-existing-media.ts
//
// Requires INGEST_SECRET + the deployed /api/mirror-media endpoint
// to be live (we hit production, not localhost — hosting binary
// downloads on a vercel function is what we want).

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

const RATE_LIMIT_MS = 250;

async function main() {
  const ingestUrl = process.env.INGEST_URL;
  const ingestSecret = process.env.INGEST_SECRET;
  if (!ingestUrl || !ingestSecret) {
    throw new Error(
      'set INGEST_URL (e.g. https://linkedin-analytics-topaz.vercel.app/api/ingest) ' +
        'and INGEST_SECRET in .env.local',
    );
  }
  const base = ingestUrl.replace(/\/api\/ingest\/?$/, '');
  const mirrorUrl = `${base}/api/mirror-media`;

  const rows = (await db.execute(sql`
    SELECT activity_id, source_url
    FROM post_media
    WHERE blob_url IS NULL
    ORDER BY uploaded_at DESC
  `)) as unknown as Array<{ activity_id: string; source_url: string }>;

  console.log(`${rows.length} media rows still need mirroring.`);
  if (rows.length === 0) return;

  let mirrored = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    try {
      const resp = await fetch(mirrorUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ingest-Secret': ingestSecret,
        },
        body: JSON.stringify({
          activityId: r.activity_id,
          sourceUrl: r.source_url,
        }),
      });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && body.action === 'mirrored') {
        mirrored++;
        console.log(
          `  ✓ ${r.activity_id} (${body.bytes ? Math.round(body.bytes / 1024) + 'kb' : '?'})`,
        );
      } else if (resp.ok && body.action === 'already-mirrored') {
        skipped++;
      } else {
        failed++;
        console.log(`  ✗ ${r.activity_id}: ${resp.status} ${JSON.stringify(body)}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ${r.activity_id}: ${err}`);
    }
    // Be polite — don't hammer the LinkedIn CDN.
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
  }

  console.log(
    `\nDone. Mirrored=${mirrored}, already=${skipped}, failed=${failed}.`,
  );
  if (failed > 0) {
    console.log(
      'Failures are usually expired CDN URLs (older posts). Re-run is safe.',
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
