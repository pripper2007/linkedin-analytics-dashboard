// Inspect post_content for Unicode replacement characters (U+FFFD).
// These appear when invalid UTF-8 byte sequences are decoded.
// Reports which source (seed / csv / extension) introduced corruption.

import { db } from '../src/db/client';
import { sql } from 'drizzle-orm';

interface Row {
  activity_id: string;
  posted_at: string;
  first_seen_at: string;
  post_url: string;
  snippet: string;
  total_length: number;
  replacement_char_count: number;
}

async function main() {
  const rows = (await db.execute(sql`
    SELECT
      activity_id,
      posted_at,
      first_seen_at,
      post_url,
      -- Extract a snippet around the first replacement char so we can
      -- see the context.
      SUBSTRING(
        post_content
        FROM GREATEST(1, POSITION(U&'\\FFFD' IN post_content) - 40)
        FOR 120
      ) AS snippet,
      LENGTH(post_content) AS total_length,
      (LENGTH(post_content) - LENGTH(REPLACE(post_content, U&'\\FFFD', ''))) AS replacement_char_count
    FROM posts
    WHERE post_content LIKE '%' || U&'\\FFFD' || '%'
    ORDER BY posted_at DESC
    LIMIT 50
  `)) as unknown as Row[];

  console.log(`posts with U+FFFD replacement char: ${rows.length}`);
  if (rows.length === 0) {
    console.log('(no corruption found at rest — the display must be introducing it)');
    return;
  }
  console.log('---');
  for (const r of rows.slice(0, 15)) {
    const urlKind =
      r.post_url.includes('/feed/update/urn') ? 'csv/seed (urn url)'
      : r.post_url.includes('/posts/pedroripper') ? 'extension'
      : 'unknown';
    console.log(
      `${r.activity_id}  ${r.posted_at.slice(0, 10)}  ${urlKind}`,
    );
    console.log(`  snippet: ${JSON.stringify(r.snippet)}`);
    console.log(`  ${r.replacement_char_count} replacement chars in ${r.total_length} bytes`);
    console.log();
  }

  // By first_seen_at, classify which import path introduced these.
  const bySrc = (await db.execute(sql`
    SELECT
      CASE
        WHEN post_url LIKE '%feed/update/urn%' THEN 'feed/update URL (csv or seed)'
        WHEN post_url LIKE '%posts/pedroripper%' THEN 'posts/vanity URL (extension)'
        ELSE 'other'
      END AS source,
      COUNT(*)::int AS n
    FROM posts
    WHERE post_content LIKE '%' || U&'\\FFFD' || '%'
    GROUP BY 1
    ORDER BY 2 DESC
  `)) as unknown as Array<{ source: string; n: number }>;
  console.log('Corruption by likely source:');
  for (const b of bySrc) console.log(`  ${b.n.toString().padStart(4)}  ${b.source}`);
}

main().then(() => process.exit(0));
