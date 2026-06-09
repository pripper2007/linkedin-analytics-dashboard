// Pure transform functions that convert the existing master JSON shape into
// rows matching src/db/schema.ts. Zero I/O here on purpose — these are the
// functions the unit tests exercise directly.

import type {
  NewPost,
  NewPostSnapshot,
  NewPostDemographic,
  NewProfileSnapshot,
  NewDailyEngagementRow,
} from '../src/db/schema';
import type {
  Post as JsonPost,
  Profile as JsonProfile,
  DailyEntry as JsonDailyEntry,
  Demographics as JsonDemographics,
} from '../src/lib/types';

// -------------------------------------------------------------------------
// Percentage parser.
//
// LinkedIn exports percentages as strings like "35%", "2%", or "<1%".
// We store numeric(6,2) in the DB. "<1%" is a range — we use its midpoint
// (0.5) so downstream sorting/comparisons behave sensibly. Same for ">X%".
// -------------------------------------------------------------------------
export function parsePct(raw: string): number {
  const s = raw.trim();
  if (s.startsWith('<')) {
    const n = parseFloat(s.replace(/[<>%]/g, ''));
    return Number.isNaN(n) ? 0 : n / 2;
  }
  if (s.startsWith('>')) {
    const n = parseFloat(s.replace(/[<>%]/g, ''));
    return Number.isNaN(n) ? 0 : (n + 100) / 2;
  }
  const n = parseFloat(s.replace('%', ''));
  return Number.isNaN(n) ? 0 : n;
}

// -------------------------------------------------------------------------
// Posted-at parser.
//
// Input: post_date "M/D/YYYY" (e.g. "4/3/2026") + publish_time "H:MM AM/PM".
// We interpret these as America/Sao_Paulo wall time (the user's timezone —
// LinkedIn shows post times in the viewer's locale). Brazil no longer
// observes DST since 2019, so UTC-3 is a stable offset.
//
// Returns a UTC Date. If anything fails to parse, throws — we'd rather know
// than silently drop a post into the epoch.
// -------------------------------------------------------------------------
const SAO_PAULO_OFFSET_HOURS = 3; // UTC = local + 3

export function parsePostedAt(dateStr: string, timeStr: string): Date {
  const dateMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateStr.trim());
  if (!dateMatch) throw new Error(`Invalid post_date: ${dateStr}`);
  const [, mm, dd, yyyy] = dateMatch;

  // Some older posts have an empty publish_time in the master JSON.
  // Falling back to midnight preserves the date; we can backfill real
  // times later from the Voyager ingest.
  let hour = 0;
  let minute = 0;
  const trimmedTime = timeStr.trim();
  if (trimmedTime.length > 0) {
    const timeMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(trimmedTime);
    if (!timeMatch) throw new Error(`Invalid publish_time: ${timeStr}`);
    const [, hhStr, minStr, ampm] = timeMatch;
    hour = Number(hhStr);
    minute = Number(minStr);
    if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  }

  // Wall-time in São Paulo → UTC by adding the offset.
  const utcMs = Date.UTC(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    hour + SAO_PAULO_OFFSET_HOURS,
    minute,
    0,
  );
  return new Date(utcMs);
}

// -------------------------------------------------------------------------
// JSON post → posts table row.
// -------------------------------------------------------------------------
export function toPostRow(p: JsonPost): NewPost {
  return {
    activityId: p.activity_id,
    postContent: p.post_content,
    postUrl: p.post_url,
    postedAt: parsePostedAt(p.post_date, p.publish_time),
    topic: p.topic || null,
    style: p.style || null,
    imageType: p.image_type || null,
    wordCount: p.word_count,
    paragraphCount: p.paragraph_count,
    hasLink: p.has_link,
    hasImage: p.has_image,
    hasBoldUnicode: p.has_bold_unicode,
    hasEmoji: p.has_emoji,
    hasBulletPoints: p.has_bullet_points,
    hasQuestion: p.has_question,
    featureCount: p.feature_count,
  };
}

// -------------------------------------------------------------------------
// JSON post → post_snapshots table row for the given snapshot date.
//
// The existing JSON doesn't break reactions out by type, so the type-specific
// columns (reactions_like, etc.) stay null. Voyager data will fill those in.
// -------------------------------------------------------------------------
export function toSnapshotRow(
  p: JsonPost,
  snapshotDate: string,
): NewPostSnapshot {
  return {
    activityId: p.activity_id,
    snapshotDate,
    impressions: p.impressions,
    membersReached: p.members_reached,
    socialEngagements: p.social_engagements,
    reactionsTotal: p.reactions,
    comments: p.comments,
    reposts: p.reposts,
    saves: p.saves,
    sends: p.sends,
    profileViewers: p.profile_viewers,
    followersGained: p.followers_gained,
    engagementRate: p.engagement_rate.toString(),
    dataSource: p.data_source,
  };
}

// -------------------------------------------------------------------------
// Demographics → array of post_demographics rows.
// Flattens the per-category lists into one row per (category, value) with
// the rank preserved for "top-N" rendering.
// -------------------------------------------------------------------------
export function toDemographicRows(
  activityId: string,
  snapshotDate: string,
  demographics: JsonDemographics | null,
): NewPostDemographic[] {
  if (!demographics) return [];

  const categories: Array<keyof JsonDemographics> = [
    'job_title',
    'location',
    'seniority',
    'company',
    'industry',
    'company_size',
  ];

  const rows: NewPostDemographic[] = [];
  for (const category of categories) {
    const entries = demographics[category] ?? [];
    entries.forEach((entry, idx) => {
      rows.push({
        activityId,
        snapshotDate,
        category,
        value: entry.value,
        pct: parsePct(entry.pct).toFixed(2),
        rank: idx + 1,
      });
    });
  }
  return rows;
}

// -------------------------------------------------------------------------
// JSON profile → profile_snapshots row.
// -------------------------------------------------------------------------
export function toProfileSnapshotRow(
  profile: JsonProfile,
  snapshotDate: string,
): NewProfileSnapshot {
  return {
    snapshotDate,
    totalFollowers: profile.total_followers,
    followerGrowth12mo: profile.follower_growth_12mo,
    totalImpressions12mo: profile.total_impressions_12mo,
    totalEngagements12mo: profile.total_engagements_12mo,
  };
}

// -------------------------------------------------------------------------
// JSON daily entry → daily_engagement row.
// -------------------------------------------------------------------------
export function toDailyEngagementRow(
  entry: JsonDailyEntry,
): NewDailyEngagementRow {
  return {
    date: entry.date,
    impressions: entry.impressions,
    engagements: entry.engagements,
    dayOfWeek: entry.day_of_week,
  };
}
