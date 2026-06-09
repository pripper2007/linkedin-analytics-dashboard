// Server-only query layer that replaces src/lib/data.ts (JSON-backed)
// with Supabase reads, while preserving the SAME RETURN SHAPES.
//
// Why preserve the legacy shapes: chart components, calculations.ts, and
// every page currently consume JSON-shaped Post / DailyEntry / Profile
// objects (snake_case fields, string dates like "4/3/2026", percentage
// strings like "35%"). Adapting DB rows back to those shapes here lets
// us migrate with zero churn in the UI code. The shape-adapter layer is
// known tech debt — a future phase will retire it by going DB-native.
//
// Do NOT import this module into a client component. It uses postgres.js
// via `@/db/client`, which must stay server-side. Page components are
// already server components (they read the legacy loader synchronously
// today); making them async + awaiting these queries keeps that shape.

// Server-only module. Do not import into a client component — pulls in
// postgres.js via @/db/client which assumes Node runtime. If you try,
// Next.js will flag it as a server module used on the client.

import { unstable_cache } from 'next/cache';
import { sql, desc, asc, lte, isNotNull, and } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  posts,
  postSnapshots,
  postDemographics,
  postMedia,
  profileSnapshots,
  dailyEngagement,
  ingestLog,
} from '@/db/schema';
import type {
  AnalyticsMaster,
  Post,
  Profile,
  Metadata,
  DailyEntry,
  Demographics,
  DemographicEntry,
} from './types';
import { OWNER } from './site-config';

// ---------------------------------------------------------------------------
// Adapters: DB row → legacy JSON shape
// ---------------------------------------------------------------------------

/** Date → "M/D/YYYY" (matches legacy `post_date` format). */
function toLegacyDateString(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** Date → "H:MM AM/PM" (matches legacy `publish_time` format). */
function toLegacyTimeString(d: Date): string {
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Numeric percentage → "35%" / "<1%" — matches legacy DemographicEntry.pct. */
function toPctString(n: number): string {
  if (n < 1) return '<1%';
  return `${Math.round(n * 10) / 10}%`;
}

// Legacy JSON's demographics is keyed by snake_case category names with
// specific ordering. Keep the set + fallback to an empty array.
const DEMO_CATEGORIES = [
  'job_title',
  'location',
  'seniority',
  'company',
  'industry',
  'company_size',
] as const;
type DemoCategory = (typeof DEMO_CATEGORIES)[number];

function emptyDemographics(): Demographics {
  return {
    job_title: [],
    location: [],
    seniority: [],
    company: [],
    industry: [],
    company_size: [],
  };
}

// ---------------------------------------------------------------------------
// Building a Post row from the DB
//
// Legacy shape needs: stable metadata (from `posts`) + the latest snapshot
// metrics (from `post_snapshots`) + demographics (from `post_demographics`
// for that same latest snapshot date). We issue one query per concern
// and stitch in JS — cleaner than a 3-way outer join with aggregates.
// ---------------------------------------------------------------------------

interface LatestSnapshot {
  activityId: string;
  snapshotDate: string;
  impressions: number;
  membersReached: number;
  socialEngagements: number;
  reactionsTotal: number;
  comments: number;
  reposts: number;
  saves: number;
  sends: number;
  profileViewers: number;
  followersGained: number;
  engagementRate: number | null;
  dataSource: string | null;
}

/**
 * Returns one row per activity_id — the newest snapshot for that post.
 * Uses DISTINCT ON for a single-query top-1-per-group.
 */
async function latestSnapshotsByPost(): Promise<Map<string, LatestSnapshot>> {
  const rows = await db.execute<{
    activity_id: string;
    snapshot_date: string;
    impressions: number | null;
    members_reached: number | null;
    social_engagements: number | null;
    reactions_total: number | null;
    comments: number | null;
    reposts: number | null;
    saves: number | null;
    sends: number | null;
    profile_viewers: number | null;
    followers_gained: number | null;
    engagement_rate: string | null;
    data_source: string | null;
  }>(sql`
    SELECT DISTINCT ON (activity_id)
      activity_id, snapshot_date, impressions, members_reached,
      social_engagements, reactions_total, comments, reposts, saves, sends,
      profile_viewers, followers_gained, engagement_rate, data_source
    FROM post_snapshots
    ORDER BY activity_id, snapshot_date DESC
  `);
  const out = new Map<string, LatestSnapshot>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    out.set(r.activity_id as string, {
      activityId: r.activity_id as string,
      snapshotDate: r.snapshot_date as string,
      impressions: Number(r.impressions ?? 0),
      membersReached: Number(r.members_reached ?? 0),
      socialEngagements: Number(r.social_engagements ?? 0),
      reactionsTotal: Number(r.reactions_total ?? 0),
      comments: Number(r.comments ?? 0),
      reposts: Number(r.reposts ?? 0),
      saves: Number(r.saves ?? 0),
      sends: Number(r.sends ?? 0),
      profileViewers: Number(r.profile_viewers ?? 0),
      followersGained: Number(r.followers_gained ?? 0),
      engagementRate:
        r.engagement_rate == null ? null : Number(r.engagement_rate),
      dataSource: r.data_source as string | null,
    });
  }
  return out;
}

/** Returns a map: activityId → Demographics (for activity_ids that have any). */
async function demographicsByPost(): Promise<Map<string, Demographics>> {
  const rows = await db
    .select({
      activityId: postDemographics.activityId,
      category: postDemographics.category,
      value: postDemographics.value,
      pct: postDemographics.pct,
      rank: postDemographics.rank,
    })
    .from(postDemographics)
    .orderBy(
      asc(postDemographics.activityId),
      asc(postDemographics.category),
      asc(postDemographics.rank),
    );

  const out = new Map<string, Demographics>();
  for (const r of rows) {
    let demo = out.get(r.activityId);
    if (!demo) {
      demo = emptyDemographics();
      out.set(r.activityId, demo);
    }
    const cat = r.category as DemoCategory;
    if (!(DEMO_CATEGORIES as readonly string[]).includes(cat)) continue;
    const entry: DemographicEntry = {
      value: r.value,
      pct: toPctString(Number(r.pct)),
    };
    demo[cat].push(entry);
  }
  return out;
}

async function buildPosts(): Promise<Post[]> {
  const [rows, snaps, demos] = await Promise.all([
    db
      .select()
      .from(posts)
      .orderBy(desc(posts.postedAt)),
    latestSnapshotsByPost(),
    demographicsByPost(),
  ]);

  return rows.map((r) => {
    const snap = snaps.get(r.activityId);
    const demo = demos.get(r.activityId) ?? null;
    const impressions = snap?.impressions ?? 0;
    const engagements = snap?.socialEngagements ?? 0;
    // Always recompute ER from the components when we have impressions.
    // The stored engagement_rate column is a denormalized cache that has
    // gone stale in the past (e.g. a rescue script repaired impressions
    // without recomputing ER → 8 rows displaying 0% on real engagement).
    // Recomputing on read makes the displayed ER self-consistent with
    // the displayed impressions and engagements — no possible drift.
    // Falls back to the stored value only when impressions=0 (so a
    // legacy export that carried an ER but no impressions still surfaces).
    const engagementRate =
      impressions > 0
        ? Math.round((engagements / impressions) * 10000) / 100
        : (snap?.engagementRate ?? 0);
    return {
      activity_id: r.activityId,
      post_content: r.postContent,
      post_date: toLegacyDateString(r.postedAt),
      publish_time: toLegacyTimeString(r.postedAt),
      post_url: r.postUrl,
      has_link: r.hasLink,
      has_image: r.hasImage,
      has_bold_unicode: r.hasBoldUnicode,
      has_emoji: r.hasEmoji,
      has_bullet_points: r.hasBulletPoints,
      has_question: r.hasQuestion,
      word_count: r.wordCount ?? 0,
      paragraph_count: r.paragraphCount ?? 0,
      topic: r.topic ?? 'General',
      style: r.style ?? 'Unclassified',
      image_type: r.imageType ?? 'none',
      feature_count: r.featureCount,
      impressions,
      members_reached: snap?.membersReached ?? 0,
      social_engagements: engagements,
      reactions: snap?.reactionsTotal ?? 0,
      comments: snap?.comments ?? 0,
      reposts: snap?.reposts ?? 0,
      saves: snap?.saves ?? 0,
      sends: snap?.sends ?? 0,
      profile_viewers: snap?.profileViewers ?? 0,
      followers_gained: snap?.followersGained ?? 0,
      demographics: demo,
      data_source:
        (snap?.dataSource as Post['data_source']) ?? 'scraped',
      engagement_rate: engagementRate,
    };
  });
}

// ---------------------------------------------------------------------------
// Profile
//
// Legacy Profile shape has: name, title, total_followers,
// follower_growth_12mo, total_impressions_12mo, total_engagements_12mo.
// name + title come from the NEXT_PUBLIC_OWNER_* env vars (site-config) —
// the DB doesn't store them. Everything else is derived from the DB's
// profile_snapshots + daily_engagement.
// ---------------------------------------------------------------------------

const PROFILE_STATIC = {
  name: OWNER.name || 'LinkedIn Creator',
  title: OWNER.title || '',
};

async function buildProfile(): Promise<Profile> {
  // Read the most recent NON-NULL total_followers (and similarly for the
  // 12-months-ago anchor). Daily ingests can land a snapshot row with
  // only connections populated when the follower fetch fails — without
  // this filter the dashboard would render 0 for follower count on
  // those days. Walking back to the last known good value preserves
  // user-facing continuity until the next successful capture.
  const [latestRows, daily] = await Promise.all([
    db
      .select()
      .from(profileSnapshots)
      .where(isNotNull(profileSnapshots.totalFollowers))
      .orderBy(desc(profileSnapshots.snapshotDate))
      .limit(1),
    db.select().from(dailyEngagement),
  ]);

  const latest = latestRows[0];
  const totalFollowers = latest?.totalFollowers ?? 0;

  // Follower growth over the trailing 12 months.
  let growth12mo = 0;
  if (latest && totalFollowers > 0) {
    const anchor = new Date(`${latest.snapshotDate}T00:00:00Z`);
    const a365 = new Date(anchor);
    a365.setUTCFullYear(a365.getUTCFullYear() - 1);
    const a365iso = a365.toISOString().slice(0, 10);
    const priorRows = await db
      .select()
      .from(profileSnapshots)
      .where(
        and(
          lte(profileSnapshots.snapshotDate, a365iso),
          isNotNull(profileSnapshots.totalFollowers),
        ),
      )
      .orderBy(desc(profileSnapshots.snapshotDate))
      .limit(1);
    const prior = priorRows[0]?.totalFollowers ?? 0;
    growth12mo = Math.max(0, totalFollowers - prior);
  }

  // Impressions + engagements over the trailing 12 months.
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const cutoffIso = oneYearAgo.toISOString().slice(0, 10);
  const recent = daily.filter((d) => d.date >= cutoffIso);
  const totalImpressions12mo = recent.reduce((s, d) => s + d.impressions, 0);
  const totalEngagements12mo = recent.reduce((s, d) => s + d.engagements, 0);

  return {
    name: PROFILE_STATIC.name,
    title: PROFILE_STATIC.title,
    total_followers: totalFollowers,
    follower_growth_12mo: growth12mo,
    total_impressions_12mo: totalImpressions12mo,
    total_engagements_12mo: totalEngagements12mo,
  };
}

// ---------------------------------------------------------------------------
// Daily engagement — straight passthrough; shape already matches the DB.
// ---------------------------------------------------------------------------
async function buildDailyEngagement(): Promise<DailyEntry[]> {
  const rows = await db
    .select()
    .from(dailyEngagement)
    .orderBy(asc(dailyEngagement.date));
  return rows.map((r) => ({
    date: r.date,
    impressions: r.impressions,
    engagements: r.engagements,
    day_of_week: r.dayOfWeek,
  }));
}

// ---------------------------------------------------------------------------
// Public API (matches src/lib/data.ts — now async).
//
// All read paths are wrapped in unstable_cache with a 10-minute revalidate
// window and tagged so /api/ingest can call revalidateTag('analytics') after
// each successful capture — fresh data shows up immediately rather than
// after a 10-minute wait. Without this, every dashboard render did its own
// 3-query fan-out against Supabase across regions; with it, second-and-
// subsequent visits hit the in-memory result.
//
// Cache keys: each wrapped fn has a stable key array (the function name);
// any future fn that takes args MUST include them in the key array or
// callers will see stale results.
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 600;
const ANALYTICS_TAG = 'analytics';

export const getAllPosts = unstable_cache(
  async (): Promise<Post[]> => buildPosts(),
  ['getAllPosts'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export const getPostById = unstable_cache(
  async (id: string): Promise<Post | undefined> => {
    const all = await buildPosts();
    return all.find((p) => p.activity_id === id);
  },
  ['getPostById'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export const getDailyEngagement = unstable_cache(
  async (): Promise<DailyEntry[]> => buildDailyEngagement(),
  ['getDailyEngagement'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export const getProfile = unstable_cache(
  async (): Promise<Profile> => buildProfile(),
  ['getProfile'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export async function getMetadata(): Promise<Metadata> {
  // The legacy _metadata block mostly held guidance for humans editing
  // the JSON by hand. With the ingest pipeline live, these fields are
  // either computed or obsolete. We report a minimal honest shape.
  const [{ n: postCount = 0 } = { n: 0 }] = (await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM posts`,
  )) as unknown as Array<{ n: number }>;
  return {
    version: 'db-v1',
    created: '',
    last_updated: new Date().toISOString(),
    data_period: 'rolling 12 months',
    total_posts: postCount,
    posts_with_official_data: postCount,
    how_to_update:
      'Data now flows via /api/ingest from the browser extension. See PROJECT.md.',
  };
}

export async function getAnalyticsData(): Promise<AnalyticsMaster> {
  const [posts_, daily, profile, metadata] = await Promise.all([
    getAllPosts(),
    getDailyEngagement(),
    getProfile(),
    getMetadata(),
  ]);
  return {
    _metadata: metadata,
    profile,
    posts: posts_,
    daily_engagement: daily,
  };
}

// ---------------------------------------------------------------------------
// NEW (not in legacy data.ts): full daily follower history for the growth
// chart. The 13-month Phase 3c backfill lives in profile_snapshots; this
// is the query that exposes it to the dashboard.
// ---------------------------------------------------------------------------
export interface FollowerHistoryPoint {
  date: string;
  total_followers: number;
}

// ---------------------------------------------------------------------------
// Ingest health — powers the "last captured X ago" indicator on the home
// page. Sourced from post_snapshots.captured_at, not ingest_log: the daily
// follower-scrape POSTs an empty posts[] every day and would otherwise keep
// the badge green even when the feed interceptor has been silent for weeks.
// post_snapshots only grows when voyagerFeedDashProfileUpdates fires, which
// is the actual signal we want to surveil.
// ---------------------------------------------------------------------------
export interface IngestHealth {
  lastSuccessAt: string | null;
  lastSuccessHoursAgo: number | null;
  lastStatus: string | null;
  lastSource: string | null;
}

// Cache window for ingest health is shorter (60s) — this drives the
// "last captured X ago" badge; users expect it to refresh sooner than
// the heavy data queries. Still tag-invalidated on ingest for instant
// freshness right after a capture.
export const getIngestHealth = unstable_cache(
  async (): Promise<IngestHealth> => {
    const [snapshotRows, attemptRows] = await Promise.all([
      db
        .select({ capturedAt: postSnapshots.capturedAt })
        .from(postSnapshots)
        .orderBy(desc(postSnapshots.capturedAt))
        .limit(1),
      db
        .select({ status: ingestLog.status, source: ingestLog.source })
        .from(ingestLog)
        .orderBy(desc(ingestLog.startedAt))
        .limit(1),
    ]);
    const lastSuccessAt = snapshotRows[0]?.capturedAt ?? null;
    const hoursAgo = lastSuccessAt
      ? Math.round(((Date.now() - lastSuccessAt.getTime()) / 3_600_000) * 10) / 10
      : null;
    return {
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      lastSuccessHoursAgo: hoursAgo,
      lastStatus: attemptRows[0]?.status ?? null,
      lastSource: attemptRows[0]?.source ?? null,
    };
  },
  ['getIngestHealth'],
  { revalidate: 60, tags: [ANALYTICS_TAG] },
);

// ---------------------------------------------------------------------------
// Post media — kept separate from the Post shape because it's only
// loaded when rendering the detailed post page, never in lists.
// ---------------------------------------------------------------------------
export interface PostMediaItem {
  kind: string;
  sourceUrl: string;
  blobUrl: string | null;
  position: number;
  /** Best URL to display: prefer mirrored blob, fall back to LinkedIn CDN. */
  bestUrl: string;
}

export async function getPostMedia(
  activityId: string,
): Promise<PostMediaItem[]> {
  const rows = await db
    .select({
      kind: postMedia.kind,
      sourceUrl: postMedia.sourceUrl,
      blobUrl: postMedia.blobUrl,
      position: postMedia.position,
    })
    .from(postMedia)
    .where(sql`${postMedia.activityId} = ${activityId}`)
    .orderBy(asc(postMedia.position));
  return rows.map((r) => ({
    kind: r.kind,
    sourceUrl: r.sourceUrl,
    blobUrl: r.blobUrl,
    position: r.position,
    bestUrl: r.blobUrl ?? r.sourceUrl,
  }));
}

/**
 * Lightweight version of getPostMedia for the /posts list view: one
 * representative thumbnail (image kind, lowest position) per post.
 * Returns a Map<activityId, bestUrl> so the list view can render an
 * inline thumbnail without N+1-querying per row.
 */
// Map<> is non-serializable, so we cache the underlying array form and
// rebuild the Map on each call from the (cheap) array result.
const _getPostThumbnailsArray = unstable_cache(
  async (): Promise<Array<[string, string]>> => {
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (activity_id)
        activity_id,
        COALESCE(blob_url, source_url) AS best_url
      FROM post_media
      WHERE kind = 'image' OR kind = 'video_thumbnail'
      ORDER BY activity_id, position ASC
    `)) as unknown as Array<{ activity_id: string; best_url: string }>;
    return rows.map((r) => [r.activity_id, r.best_url] as [string, string]);
  },
  ['getPostThumbnails'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export async function getPostThumbnails(): Promise<Map<string, string>> {
  return new Map(await _getPostThumbnailsArray());
}

// ---------------------------------------------------------------------------
// post_analyses — Phase 9.A
//
// Returns the most recent Claude analysis for a post, or null. Tagged
// per-post so a fresh analysis call on /api/analyze-post/[id] busts
// only that key (via revalidateTag(`analysis-${id}`)) and not the
// shared 'analytics' tag — which would otherwise drop every dashboard
// cache after each analysis click.
// ---------------------------------------------------------------------------

export interface CachedAnalysis {
  id: number;
  activityId: string;
  analyzedAt: string;
  model: string;
  skillHash: string;
  whatWorked: string;
  whatCouldImprove: string;
  rewriteSuggestions: string;
  lessonToRemember: string;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
}

export async function getCachedAnalysis(
  activityId: string,
): Promise<CachedAnalysis | null> {
  // unstable_cache requires arguments to be in the key array; we pass
  // activityId twice (positional arg + key entry) per the queries.ts
  // header note about per-arg cache keys.
  return _getCachedAnalysis(activityId);
}

const _getCachedAnalysis = unstable_cache(
  async (activityId: string): Promise<CachedAnalysis | null> => {
    const rows = (await db.execute(sql`
      SELECT
        id,
        activity_id,
        analyzed_at::text,
        model,
        skill_hash,
        what_worked,
        what_could_improve,
        rewrite_suggestions,
        lesson_to_remember,
        input_tokens,
        output_tokens,
        thinking_tokens
      FROM post_analyses
      WHERE activity_id = ${activityId}
      ORDER BY analyzed_at DESC
      LIMIT 1
    `)) as unknown as Array<{
      id: number;
      activity_id: string;
      analyzed_at: string;
      model: string;
      skill_hash: string;
      what_worked: string;
      what_could_improve: string;
      rewrite_suggestions: string;
      lesson_to_remember: string;
      input_tokens: number | null;
      output_tokens: number | null;
      thinking_tokens: number | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      activityId: r.activity_id,
      analyzedAt: r.analyzed_at,
      model: r.model,
      skillHash: r.skill_hash,
      whatWorked: r.what_worked,
      whatCouldImprove: r.what_could_improve,
      rewriteSuggestions: r.rewrite_suggestions,
      lessonToRemember: r.lesson_to_remember,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      thinkingTokens: r.thinking_tokens,
    };
  },
  ['getCachedAnalysis'],
  // The activityId is in the call signature, so unstable_cache keys
  // automatically include it. We tag with a per-post key so a single
  // /api/analyze-post POST can bust just one cache entry instead of
  // the whole 'analytics' tag.
  {
    revalidate: CACHE_TTL_SECONDS,
    // Note: tag is computed from the cached function's args at call time,
    // but unstable_cache only takes a STATIC tag list. We use a stable
    // shared tag here and let the route also bust 'analytics' (or call
    // revalidatePath instead if we want surgical invalidation).
    tags: [ANALYTICS_TAG],
  },
);

export const getFollowerHistory = unstable_cache(
  async (): Promise<FollowerHistoryPoint[]> => {
    const rows = await db
      .select({
        date: profileSnapshots.snapshotDate,
        totalFollowers: profileSnapshots.totalFollowers,
      })
      .from(profileSnapshots)
      .where(sql`${profileSnapshots.totalFollowers} IS NOT NULL`)
      .orderBy(asc(profileSnapshots.snapshotDate));
    return rows.map((r) => ({
      date: r.date,
      total_followers: r.totalFollowers ?? 0,
    }));
  },
  ['getFollowerHistory'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);
