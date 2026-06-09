// scripts/reconcile-duplicate-posts.ts
//
// One-shot cleanup for the duplicate-post issue introduced by mixing two
// ingest paths:
//   - `scripts/seed.ts`               (authoritative URN from master JSON)
//   - `scripts/backfill-historical.ts` (share/activity URN extracted from
//                                       Shares.csv)
//
// LinkedIn issues different URN namespaces (`share` vs `activity` vs
// `ugcPost`) for the same logical post, so the two paths can land the same
// post under two different activity_id values. The original minute-level
// timestamp dedup in backfill didn't catch them because the JSON seed's
// publish_time and the CSV's server UTC timestamp can differ by hours.
//
// Strategy per matched pair:
//   1. Survivor = the post whose classification metadata is populated
//      (topic/style non-null). Tie-break → more post_snapshots. Further
//      tie-break → earlier first_seen_at.
//   2. Re-parent loser's child rows onto the survivor's activity_id where
//      the unique constraint allows; drop the loser's child rows that
//      conflict (survivor already has a row for that key, which is fine
//      because the survivor is the authoritative side).
//   3. Delete the loser's `posts` row. Any remaining children cascade.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/reconcile-duplicate-posts.ts --dry-run
//   npx tsx --env-file=.env.local scripts/reconcile-duplicate-posts.ts --apply
//
// The script refuses to touch the DB unless --apply is passed explicitly.

import { sql } from 'drizzle-orm';
import { db } from '../src/db/client';

// How many characters of normalized post content must match for two rows
// to be considered the same logical post. Kept in sync with
// scripts/content-fingerprint.ts — see the comment there for why 30.
const MATCH_PREFIX_CHARS = 30;

// Maximum time difference between two candidate posts (in hours) for them
// to be considered the same post. Initially 30h (covered seed-vs-CSV TZ
// drift), but LinkedIn's Shares.csv also records post EDITS as separate
// rows with different URNs — a single post edited days later becomes two
// export rows. 72h catches typical same-post edits without letting
// unrelated same-fingerprint posts drift in: the safeguard against false
// positives is the content-fingerprint match on the first 40 chars AND
// the "skip classes with multiple authoritative members" rule in main().
const MATCH_WINDOW_HOURS = 72;

interface PairRow {
  a_id: string;
  b_id: string;
  a_posted: string;
  b_posted: string;
  a_topic: string | null;
  a_style: string | null;
  b_topic: string | null;
  b_style: string | null;
  a_first_seen: string;
  b_first_seen: string;
  a_snap_count: number;
  b_snap_count: number;
  content_sample: string;
}

async function findDuplicatePairs(): Promise<PairRow[]> {
  // Self-join on normalized content prefix + time window. The normalizer
  // strips whitespace, straight/curly quotes, and control chars so that
  // the CSV-exported body (which wraps multi-line posts in quotes and
  // escapes internal quotes) matches the seed JSON body.
  //
  // NOTE: MATCH_PREFIX_CHARS and MATCH_WINDOW_HOURS are inlined via
  // sql.raw rather than ${} parameter binding. They're hardcoded
  // compile-time constants (no injection surface), and drizzle's
  // parameterized ints behave oddly when used as the length argument
  // to LEFT() — it silently filters rows that should match. Using
  // sql.raw with String(N) forces them into the SQL text as literals.
  // Build the char class as a raw SQL fragment so the backslash in \s
  // reaches Postgres as one character, not as drizzle's parameter escape.
  // Whitespace + straight + smart quotes (all possible in CSV-export data).
  const STRIP = sql.raw(`'[\\s"''“”‘’]+'`);
  const prefixLen = sql.raw(String(MATCH_PREFIX_CHARS));
  const windowSec = sql.raw(String(MATCH_WINDOW_HOURS * 3600));
  const rows = await db.execute(sql`
    WITH normed AS (
      SELECT
        activity_id, posted_at, topic, style, first_seen_at, post_content,
        LEFT(REGEXP_REPLACE(post_content, ${STRIP}, '', 'g'), ${prefixLen}) AS fingerprint
      FROM posts
      WHERE LENGTH(REGEXP_REPLACE(post_content, ${STRIP}, '', 'g')) >= ${prefixLen}
    ),
    counts AS (
      SELECT activity_id, COUNT(*)::int AS snap_count
      FROM post_snapshots GROUP BY activity_id
    )
    SELECT
      a.activity_id      AS a_id,
      b.activity_id      AS b_id,
      a.posted_at        AS a_posted,
      b.posted_at        AS b_posted,
      a.topic            AS a_topic,
      a.style            AS a_style,
      b.topic            AS b_topic,
      b.style            AS b_style,
      a.first_seen_at    AS a_first_seen,
      b.first_seen_at    AS b_first_seen,
      COALESCE(ca.snap_count, 0) AS a_snap_count,
      COALESCE(cb.snap_count, 0) AS b_snap_count,
      LEFT(a.post_content, 60)   AS content_sample
    FROM normed a
    JOIN normed b
      ON a.activity_id < b.activity_id
     AND a.fingerprint = b.fingerprint
     AND ABS(EXTRACT(EPOCH FROM (a.posted_at - b.posted_at))) <= ${windowSec}
    LEFT JOIN counts ca ON ca.activity_id = a.activity_id
    LEFT JOIN counts cb ON cb.activity_id = b.activity_id
    ORDER BY a.posted_at DESC
  `);
  return rows as unknown as PairRow[];
}

interface ApplyCounts {
  snapshotsMoved: number;
  snapshotsDropped: number;
  demographicsMoved: number;
  demographicsDropped: number;
  mediaMoved: number;
  postsDeleted: number;
}

/**
 * For a single (survivor, loser) pair, re-parent the loser's children
 * onto the survivor where possible, drop children that would violate a
 * unique constraint on the survivor, then delete the loser's posts row.
 *
 * Runs inside a transaction so a partial failure can't leave dangling
 * children behind.
 */
async function applyPair(
  survivor: string,
  loser: string,
): Promise<ApplyCounts> {
  return db.transaction(async (tx) => {
    // --- post_snapshots ---
    // Move loser's snapshots onto survivor where survivor has no row for
    // that date. Any snapshot on a date the survivor already owns is
    // deleted — the survivor's value wins (it's the authoritative side).
    const movedSnaps = await tx.execute(sql`
      UPDATE post_snapshots ps
      SET activity_id = ${survivor}
      WHERE ps.activity_id = ${loser}
        AND NOT EXISTS (
          SELECT 1 FROM post_snapshots ps2
          WHERE ps2.activity_id = ${survivor}
            AND ps2.snapshot_date = ps.snapshot_date
        )
      RETURNING 1
    `);
    const droppedSnaps = await tx.execute(sql`
      DELETE FROM post_snapshots WHERE activity_id = ${loser} RETURNING 1
    `);

    // --- post_demographics ---
    const movedDemos = await tx.execute(sql`
      UPDATE post_demographics pd
      SET activity_id = ${survivor}
      WHERE pd.activity_id = ${loser}
        AND NOT EXISTS (
          SELECT 1 FROM post_demographics pd2
          WHERE pd2.activity_id = ${survivor}
            AND pd2.snapshot_date = pd.snapshot_date
            AND pd2.category = pd.category
            AND pd2.value = pd.value
        )
      RETURNING 1
    `);
    const droppedDemos = await tx.execute(sql`
      DELETE FROM post_demographics WHERE activity_id = ${loser} RETURNING 1
    `);

    // --- post_media ---
    // post_media has no composite unique constraint, so every row can be
    // re-parented. Duplicates by source_url across survivor+loser are rare
    // and can be pruned later if they turn up.
    const movedMedia = await tx.execute(sql`
      UPDATE post_media SET activity_id = ${survivor}
      WHERE activity_id = ${loser}
      RETURNING 1
    `);

    // --- posts (loser) ---
    await tx.execute(sql`DELETE FROM posts WHERE activity_id = ${loser}`);

    const toLen = (r: unknown): number => (r as unknown as unknown[]).length;
    return {
      snapshotsMoved: toLen(movedSnaps),
      snapshotsDropped: toLen(droppedSnaps),
      demographicsMoved: toLen(movedDemos),
      demographicsDropped: toLen(droppedDemos),
      mediaMoved: toLen(movedMedia),
      postsDeleted: 1,
    };
  });
}

function parseArgs(): { apply: boolean } {
  const apply = process.argv.includes('--apply');
  const dry = process.argv.includes('--dry-run');
  if (!apply && !dry) {
    console.error(
      'Refusing to run without an explicit mode. Pass --dry-run or --apply.',
    );
    process.exit(1);
  }
  return { apply };
}

/**
 * A pair is "risky" when both sides look authoritative: both have
 * topic + style populated AND both have snapshots. In that case the
 * two rows are most likely distinct posts that happen to share a
 * common opener (e.g. user resharing the same article twice), and
 * merging them would destroy real data. Leave them alone.
 */
function isRiskyPair(p: PairRow): boolean {
  const aAuth = !!(p.a_topic && p.a_style) && p.a_snap_count > 0;
  const bAuth = !!(p.b_topic && p.b_style) && p.b_snap_count > 0;
  return aAuth && bAuth;
}

/**
 * Groups posts into equivalence classes from the pair list using a
 * union-find structure. This prevents us from trying to merge post X
 * into Y and then later Y into Z (where Y has already been deleted).
 * Each resulting component is merged toward a single canonical survivor.
 */
class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x);
    if (p == null || p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root); // path compression
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  components(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const list = groups.get(root) ?? [];
      list.push(id);
      groups.set(root, list);
    }
    return groups;
  }
}

interface MemberInfo {
  activityId: string;
  hasMeta: boolean;
  snapCount: number;
  firstSeen: Date;
}

/**
 * Given a set of candidate duplicate activity_ids, collect the metadata
 * we need to rank them and pick the canonical survivor.
 */
function collectMembers(
  ids: string[],
  infoById: Map<string, MemberInfo>,
): MemberInfo[] {
  return ids.map((id) => {
    const info = infoById.get(id);
    if (!info) throw new Error(`missing info for ${id}`);
    return info;
  });
}

/** Same ranking rules as pickSurvivor, generalized to N members. */
function pickCanonical(members: MemberInfo[]): MemberInfo {
  const sorted = [...members].sort((a, b) => {
    if (a.hasMeta !== b.hasMeta) return a.hasMeta ? -1 : 1;
    if (a.snapCount !== b.snapCount) return b.snapCount - a.snapCount;
    return a.firstSeen.getTime() - b.firstSeen.getTime();
  });
  return sorted[0];
}

async function main(): Promise<void> {
  const { apply } = parseArgs();
  const pairs = await findDuplicatePairs();

  // Filter out risky pairs (both sides authoritative).
  const safe = pairs.filter((p) => !isRiskyPair(p));
  const skipped = pairs.length - safe.length;

  console.log(`Found ${pairs.length} candidate duplicate pairs.`);
  console.log(`Skipping ${skipped} risky pair(s) where both sides look authoritative.\n`);

  // Build equivalence classes via union-find.
  const uf = new UnionFind();
  const infoById = new Map<string, MemberInfo>();
  for (const p of safe) {
    uf.union(p.a_id, p.b_id);
    infoById.set(p.a_id, {
      activityId: p.a_id,
      hasMeta: !!(p.a_topic && p.a_style),
      snapCount: p.a_snap_count,
      firstSeen: new Date(p.a_first_seen),
    });
    infoById.set(p.b_id, {
      activityId: p.b_id,
      hasMeta: !!(p.b_topic && p.b_style),
      snapCount: p.b_snap_count,
      firstSeen: new Date(p.b_first_seen),
    });
  }

  const components = uf.components();
  console.log(`Collapsed into ${components.size} equivalence class(es).\n`);

  const totals: ApplyCounts = {
    snapshotsMoved: 0,
    snapshotsDropped: 0,
    demographicsMoved: 0,
    demographicsDropped: 0,
    mediaMoved: 0,
    postsDeleted: 0,
  };

  let skippedClasses = 0;
  for (const [, ids] of components) {
    const members = collectMembers(ids, infoById);

    // Refuse to merge an equivalence class that contains more than one
    // authoritative member. Authoritative = has classification metadata
    // AND has at least one snapshot. Multiple authoritative members could
    // mean the user genuinely posted similar content more than once; we
    // let a human resolve those rather than guessing.
    const authoritative = members.filter(
      (m) => m.hasMeta && m.snapCount > 0,
    );
    if (authoritative.length > 1) {
      console.log(
        `SKIP class size=${members.length} — ${authoritative.length} authoritative members, needs manual review:`,
      );
      for (const m of members) {
        console.log(
          `   ${m.activityId} (hasMeta=${m.hasMeta}, snaps=${m.snapCount})`,
        );
      }
      skippedClasses++;
      continue;
    }

    const canonical = pickCanonical(members);
    const losers = members.filter((m) => m.activityId !== canonical.activityId);

    console.log(
      `class size=${members.length}  survivor=${canonical.activityId} (hasMeta=${canonical.hasMeta}, snaps=${canonical.snapCount})`,
    );
    for (const l of losers) {
      console.log(
        `   loser=${l.activityId} (hasMeta=${l.hasMeta}, snaps=${l.snapCount})`,
      );
      if (apply) {
        const counts = await applyPair(canonical.activityId, l.activityId);
        console.log(
          `     applied: +${counts.snapshotsMoved}/-${counts.snapshotsDropped} snaps, +${counts.demographicsMoved}/-${counts.demographicsDropped} demos, +${counts.mediaMoved} media`,
        );
        totals.snapshotsMoved += counts.snapshotsMoved;
        totals.snapshotsDropped += counts.snapshotsDropped;
        totals.demographicsMoved += counts.demographicsMoved;
        totals.demographicsDropped += counts.demographicsDropped;
        totals.mediaMoved += counts.mediaMoved;
        totals.postsDeleted += counts.postsDeleted;
      }
    }
  }

  if (skippedClasses > 0) {
    console.log(
      `\nSKIPPED ${skippedClasses} class(es) requiring manual review (multiple authoritative members).`,
    );
  }

  if (apply) {
    console.log('\nTOTALS');
    console.log(JSON.stringify(totals, null, 2));
  } else {
    console.log('\nDRY-RUN: no changes made. Re-run with --apply to execute.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
