// Historical backfill from LinkedIn's self-service exports.
//
// Inputs:
//   1. data/AggregateAnalytics_<name>_<start>_<end>.xlsx
//        The Creator Mode analytics export. Contains 5 sheets; we import
//        three of them:
//          - ENGAGEMENT   → daily_engagement       (daily imp+engagements)
//          - FOLLOWERS    → profile_snapshots      (daily total_followers,
//                                                   reverse-cumulative from
//                                                   the pinned anchor total)
//          - DEMOGRAPHICS → profile_demographics   (company/industry % mix)
//
//   2. data/Complete_LinkedInDataExport_*/Shares.csv
//        Pedro's entire post history with date, URL, and commentary.
//        We dedup against existing `posts` rows by postedAt (rounded to
//        the minute), and for new rows insert with the share URN as the
//        primary key (since we don't have the activity URN for historical
//        posts — the extension captures going forward use activity URNs).
//
// Idempotent: re-running produces the same final DB state via upserts.
//
// Usage:  npx tsx --env-file=.env.local scripts/backfill-historical.ts

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';

import { db } from '../src/db/client';
import { posts } from '../src/db/schema';
import { upsertPost } from '../src/db/upserts';
import {
  importEngagement,
  importFollowers,
  importDemographics,
} from '../src/lib/aggregate-xlsx-import';
import { cleanLinkedInCsvQuotes } from '../src/lib/clean-linkedin-csv-quotes';
import { contentFingerprint } from './content-fingerprint';

// When fingerprint-matching a CSV row to an existing post, consider them
// the same post only if the timestamps are within this window. Two sources
// of drift: TZ/publish-time differences between JSON seed and CSV export
// (observed up to ~13h), and LinkedIn recording post EDITS as separate
// rows with different URNs (observed at ~43h for a same-day-ish edit).
// 72h covers both without letting unrelated posts drift in.
const FINGERPRINT_WINDOW_HOURS = 72;

// ---------------------------------------------------------------------------
// Paths
//
// Auto-detect the most recent AggregateAnalytics xlsx in data/ so dropping
// a fresh export in there is a no-edit operation. Filename convention:
//   AggregateAnalytics_<name>_<startDate>_<endDate>.xlsx
// We sort by the end-date embedded in the filename (which is the export's
// last-covered day) and take the highest. data/aggregate-analytics/ is
// the archive — checked as a fallback.
// ---------------------------------------------------------------------------
function pickLatestXlsx(): string {
  const dirs = ['data', 'data/aggregate-analytics'];
  const candidates: Array<{ path: string; startDate: string; endDate: string }> =
    [];
  const re =
    /^AggregateAnalytics_.+_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx$/;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const m = re.exec(file);
      if (m)
        candidates.push({
          path: path.join(dir, file),
          startDate: m[1],
          endDate: m[2],
        });
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      'No AggregateAnalytics_<name>_<start>_<end>.xlsx found in data/ ' +
        'or data/aggregate-analytics/. Export from LinkedIn → Creator ' +
        'analytics → Export, then drop the .xlsx in data/.',
    );
  }
  // Sort by end-date desc, then start-date asc (longer range wins on
  // ties — fixes the case where two exports finish on the same day but
  // cover different windows, e.g. a 7-day weekly export vs a 1-year
  // export both ending today).
  candidates.sort((a, b) => {
    if (a.endDate !== b.endDate) return a.endDate < b.endDate ? 1 : -1;
    return a.startDate < b.startDate ? -1 : 1;
  });
  return candidates[0].path;
}
const XLSX_PATH = pickLatestXlsx();
const SHARES_CSV_PATH =
  'data/Complete_LinkedInDataExport_04-13-2026.zip/Shares.csv';

// ---------------------------------------------------------------------------
// Date + timezone helpers
// ---------------------------------------------------------------------------

// Note: parseUsDate, dayOfWeek, loadSheet, importEngagement,
// importFollowers, importDemographics now live in
// src/lib/aggregate-xlsx-import.ts so the /api/import-aggregate-xlsx
// route can share them with this script. Only Shares.csv-specific
// helpers remain below.

/**
 * "2026-04-12 01:04:49" → Date (UTC).
 *
 * Shares.csv timestamps are server-side UTC (verified by cross-checking
 * against the extension-captured activity URN timestamps, which encode
 * UTC ms in their high bits). Earlier legacy JSON was local time because
 * it came from the dashboard UI; the data-export CSV is different.
 */
function parseCsvTimestamp(raw: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error(`unparseable CSV timestamp: ${raw}`);
  const [, y, mo, d, h, mi, se] = m;
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se),
    ),
  );
}

// ---------------------------------------------------------------------------
// 4. Shares.csv → posts
//
// Dedups against existing DB rows by postedAt rounded to the minute.
// For rows with no match in the DB, inserts a new `posts` row keyed by
// share URN (since we don't have the activity URN — the extension uses
// activity URNs going forward). Classification fields (topic, style,
// etc.) are left null; Pedro can backfill those later or we can derive
// simple flags from content.
// ---------------------------------------------------------------------------
interface ShareRow {
  date: string; // local timestamp
  shareLink: string;
  shareCommentary: string;
  sharedUrl: string;
  mediaUrl: string;
  visibility: string;
}

/**
 * Tiny RFC 4180 CSV parser. Handles:
 *   - fields in double quotes can contain commas, newlines, and escaped
 *     quotes ("")
 *   - CRLF or LF line endings
 * The xlsx library's CSV support corrupts multi-line quoted fields (such
 * as LinkedIn's post commentary with embedded newlines), so we parse by
 * hand here. Returns rows of strings; caller maps columns.
 */
function parseRfc4180(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        // Escaped quote ("")
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      // Collapse CRLF as a single separator.
      if (c === '\r' && i + 1 < n && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row (handles files without a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseSharesCsv(csvPath: string): ShareRow[] {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseRfc4180(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = {
    date: header.indexOf('Date'),
    shareLink: header.indexOf('ShareLink'),
    shareCommentary: header.indexOf('ShareCommentary'),
    sharedUrl: header.indexOf('SharedUrl'),
    mediaUrl: header.indexOf('MediaUrl'),
    visibility: header.indexOf('Visibility'),
  };
  if (idx.date < 0 || idx.shareLink < 0) {
    throw new Error(`Shares.csv header missing expected columns: ${header.join(',')}`);
  }
  const out: ShareRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    out.push({
      date: r[idx.date] ?? '',
      shareLink: r[idx.shareLink] ?? '',
      // Strip LinkedIn's per-paragraph CSV quoting artifact. See
      // src/lib/clean-linkedin-csv-quotes.ts for details. No-op for
      // posts that don't carry the artifact.
      shareCommentary: cleanLinkedInCsvQuotes(r[idx.shareCommentary] ?? ''),
      sharedUrl: r[idx.sharedUrl] ?? '',
      mediaUrl: r[idx.mediaUrl] ?? '',
      visibility: r[idx.visibility] ?? '',
    });
  }
  return out;
}

function extractShareUrn(link: string): string | null {
  // e.g. https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7448898891800039424
  //  or  https://www.linkedin.com/posts/pedroripper_...-share-7409196423201730560-YSZG
  const decoded = decodeURIComponent(link);
  const m =
    /urn:li:(?:share|ugcPost|activity):(\d+)/.exec(decoded) ||
    /-(share|ugcPost|activity)-(\d+)-/.exec(decoded);
  if (!m) return null;
  // 2nd or 3rd capture group depending on which regex matched
  return m[2] ?? m[1];
}

function basicContentShape(content: string): {
  wordCount: number;
  paragraphCount: number;
  hasLink: boolean;
  hasImage: boolean;
  hasEmoji: boolean;
  hasQuestion: boolean;
  hasBulletPoints: boolean;
  hasBoldUnicode: boolean;
  featureCount: number;
} {
  const wordCount = content.trim().length
    ? content.trim().split(/\s+/).length
    : 0;
  const paragraphCount = content.split(/\n{2,}/).filter((p) => p.trim()).length;
  const hasLink = /https?:\/\//i.test(content);
  const hasEmoji = /\p{Extended_Pictographic}/u.test(content);
  const hasQuestion = /\?/.test(content);
  const hasBulletPoints = /(^|\n)\s*[-•*\u2022▪]\s/.test(content);
  const hasBoldUnicode = /[\u{1D400}-\u{1D7FF}]/u.test(content); // mathematical alphanumerics
  return {
    wordCount,
    paragraphCount,
    hasLink,
    hasImage: false, // filled by caller from mediaUrl
    hasEmoji,
    hasQuestion,
    hasBulletPoints,
    hasBoldUnicode,
    featureCount:
      Number(hasLink) +
      Number(hasEmoji) +
      Number(hasQuestion) +
      Number(hasBulletPoints) +
      Number(hasBoldUnicode),
  };
}

async function loadExistingPostedAtMinutes(): Promise<Set<string>> {
  const rows = await db
    .select({ postedAt: posts.postedAt })
    .from(posts);
  const set = new Set<string>();
  for (const r of rows) {
    // Key: ISO string truncated to the minute.
    set.add(r.postedAt.toISOString().slice(0, 16));
  }
  return set;
}

/**
 * Load every existing post's (fingerprint, postedAt) pair so the CSV
 * importer can skip rows that match an already-present post by content.
 *
 * Why a Map<fingerprint, Date[]>: the same author can legitimately post
 * variants that collide on fingerprint (e.g. a weekly newsletter thread).
 * Keeping all timestamps lets us reject a CSV row only when there's an
 * existing post within a close time window — unrelated same-fingerprint
 * posts days apart aren't confused for duplicates.
 */
async function loadExistingContentFingerprints(): Promise<
  Map<string, Date[]>
> {
  const rows = await db
    .select({ postedAt: posts.postedAt, postContent: posts.postContent })
    .from(posts);
  const map = new Map<string, Date[]>();
  for (const r of rows) {
    const fp = contentFingerprint(r.postContent);
    if (!fp) continue;
    const list = map.get(fp) ?? [];
    list.push(r.postedAt);
    map.set(fp, list);
  }
  return map;
}

async function importSharesCsv(csvPath: string): Promise<{
  seen: number;
  inserted: number;
  skipped: number;
}> {
  if (!fs.existsSync(csvPath)) {
    console.warn(`Shares.csv not found at ${csvPath} — skipping post backfill`);
    return { seen: 0, inserted: 0, skipped: 0 };
  }
  const existingMinutes = await loadExistingPostedAtMinutes();
  const existingFingerprints = await loadExistingContentFingerprints();
  const windowMs = FINGERPRINT_WINDOW_HOURS * 3600 * 1000;
  const rows = parseSharesCsv(csvPath);
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.date || !r.shareLink) continue;
    let postedAt: Date;
    try {
      postedAt = parseCsvTimestamp(r.date);
    } catch {
      continue;
    }
    const minuteKey = postedAt.toISOString().slice(0, 16);
    if (existingMinutes.has(minuteKey)) {
      skipped++;
      continue;
    }
    // Content-fingerprint dedup — catches the case where the same
    // logical post was previously inserted under a different URN
    // (e.g. seed JSON's activity URN vs. this CSV's share URN) and
    // the minute keys don't align because of timezone / publish-time
    // drift. If a fingerprint match exists within the window, skip.
    const fp = contentFingerprint(r.shareCommentary);
    if (fp) {
      const prior = existingFingerprints.get(fp);
      if (prior && prior.some((d) => Math.abs(d.getTime() - postedAt.getTime()) <= windowMs)) {
        skipped++;
        continue;
      }
    }
    const urn = extractShareUrn(r.shareLink);
    if (!urn) {
      skipped++;
      continue;
    }
    const shape = basicContentShape(r.shareCommentary);
    shape.hasImage = Boolean(r.mediaUrl);
    if (r.mediaUrl) shape.featureCount += 1;
    await upsertPost(db, {
      activityId: urn,
      postContent: r.shareCommentary || '',
      postUrl: r.shareLink,
      postedAt,
      topic: null,
      style: null,
      imageType: null,
      wordCount: shape.wordCount,
      paragraphCount: shape.paragraphCount,
      hasLink: shape.hasLink,
      hasImage: shape.hasImage,
      hasBoldUnicode: shape.hasBoldUnicode,
      hasEmoji: shape.hasEmoji,
      hasBulletPoints: shape.hasBulletPoints,
      hasQuestion: shape.hasQuestion,
      featureCount: shape.featureCount,
    });
    existingMinutes.add(minuteKey); // prevent double-insert within the CSV
    if (fp) {
      const list = existingFingerprints.get(fp) ?? [];
      list.push(postedAt);
      existingFingerprints.set(fp, list);
    }
    inserted++;
  }
  return { seen: rows.length, inserted, skipped };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`xlsx not found: ${XLSX_PATH}`);
  }
  const wb = XLSX.readFile(XLSX_PATH);

  console.log('1/4  ENGAGEMENT  → daily_engagement');
  const engagementRows = await importEngagement(wb);
  console.log(`     → upserted ${engagementRows} rows`);

  console.log('2/4  FOLLOWERS   → profile_snapshots');
  const { inserted: followerRows, anchorDate, anchorTotal } =
    await importFollowers(wb);
  console.log(
    `     → upserted ${followerRows} rows (anchor ${anchorDate}=${anchorTotal})`,
  );

  console.log('3/4  DEMOGRAPHICS → profile_demographics');
  const demoRows = await importDemographics(wb, anchorDate);
  console.log(`     → upserted ${demoRows} rows`);

  // Shares.csv is optional. It comes from LinkedIn's much heavier
  // "Complete data export" (a separate request that takes ~24h to
  // generate). Skip cleanly when absent so the xlsx-only refresh path
  // is a fast 30-second job.
  if (fs.existsSync(SHARES_CSV_PATH)) {
    console.log('4/4  Shares.csv  → posts');
    const shares = await importSharesCsv(SHARES_CSV_PATH);
    console.log(
      `     → ${shares.seen} CSV rows, ${shares.inserted} new posts inserted, ${shares.skipped} skipped (already in DB or unparseable)`,
    );
  } else {
    console.log(`4/4  Shares.csv  → SKIPPED (${SHARES_CSV_PATH} not found)`);
  }

  // Summary counts post-import.
  const [engCount] = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM daily_engagement`,
  );
  const [snapCount] = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM profile_snapshots`,
  );
  const [demoCount] = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM profile_demographics`,
  );
  const [postsCount] = await db.execute(sql`SELECT COUNT(*)::int AS n FROM posts`);
  console.log('---');
  console.log(`daily_engagement:      ${(engCount as { n: number }).n}`);
  console.log(`profile_snapshots:     ${(snapCount as { n: number }).n}`);
  console.log(`profile_demographics:  ${(demoCount as { n: number }).n}`);
  console.log(`posts:                 ${(postsCount as { n: number }).n}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
