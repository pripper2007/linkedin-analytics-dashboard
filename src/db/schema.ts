// Drizzle schema for the LinkedIn Analytics Postgres database.
//
// Design: one row per post in `posts` (stable metadata), and one row per
// (post, day) in `post_snapshots` (time-series metrics). This lets the daily
// extension ingest just append a new snapshot without touching history.

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  date,
  serial,
  numeric,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// -------------------------------------------------------------------------
// posts — stable metadata per post (one row per LinkedIn post, ever).
// Content-y fields that don't change after publication live here.
// -------------------------------------------------------------------------
export const posts = pgTable(
  'posts',
  {
    // LinkedIn's activity URN, e.g. "7445950871907078144".
    activityId: text('activity_id').primaryKey(),

    postContent: text('post_content').notNull(),
    postUrl: text('post_url').notNull(),

    // When the post was published on LinkedIn (combined from old JSON's
    // post_date + publish_time; stored with timezone for reliable ordering).
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),

    // Classification / style flags (manually tagged in the master JSON today;
    // extension can fill these heuristically from post content later).
    topic: text('topic'),
    style: text('style'),
    imageType: text('image_type'),

    // Content shape
    wordCount: integer('word_count'),
    paragraphCount: integer('paragraph_count'),
    hasLink: boolean('has_link').default(false).notNull(),
    hasImage: boolean('has_image').default(false).notNull(),
    hasBoldUnicode: boolean('has_bold_unicode').default(false).notNull(),
    hasEmoji: boolean('has_emoji').default(false).notNull(),
    hasBulletPoints: boolean('has_bullet_points').default(false).notNull(),
    hasQuestion: boolean('has_question').default(false).notNull(),
    featureCount: integer('feature_count').default(0).notNull(),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),

    // Set by the ID resolver when an attempt to extract the real
    // urn:li:activity URN from a legacy share/ugcPost post page fails.
    // The queue endpoint excludes rows whose attempt was within the
    // last 24h, preventing the alarm chain from infinite-looping on
    // posts that are deleted / auth-walled / otherwise unresolvable.
    idResolveAttemptedAt: timestamp('id_resolve_attempted_at', {
      withTimezone: true,
    }),
  },
  (table) => ({
    postedAtIdx: index('posts_posted_at_idx').on(table.postedAt),
  }),
);

// -------------------------------------------------------------------------
// post_snapshots — daily time-series of per-post metrics.
// One row per (activity_id, snapshot_date). Upsert on that composite key
// so rerunning the extension twice in one day is idempotent.
// -------------------------------------------------------------------------
export const postSnapshots = pgTable(
  'post_snapshots',
  {
    id: serial('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => posts.activityId, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),

    // Reach metrics
    impressions: integer('impressions').default(0).notNull(),
    membersReached: integer('members_reached').default(0).notNull(),
    socialEngagements: integer('social_engagements').default(0).notNull(),

    // Reactions (totals — kept for back-compat with seed data)
    reactionsTotal: integer('reactions_total').default(0).notNull(),

    // Reactions by type — nullable because Voyager returns these but the
    // existing seeded JSON doesn't break them out.
    reactionsLike: integer('reactions_like'),
    reactionsCelebrate: integer('reactions_celebrate'),
    reactionsSupport: integer('reactions_support'),
    reactionsLove: integer('reactions_love'),
    reactionsInsightful: integer('reactions_insightful'),
    reactionsFunny: integer('reactions_funny'),

    comments: integer('comments').default(0).notNull(),
    reposts: integer('reposts').default(0).notNull(),
    saves: integer('saves').default(0).notNull(),
    sends: integer('sends').default(0).notNull(),

    // Clicks — only present when the post has a link.
    linkClicks: integer('link_clicks'),

    profileViewers: integer('profile_viewers').default(0).notNull(),
    followersGained: integer('followers_gained').default(0).notNull(),

    // Video metrics — populated only when the post includes a video.
    // Nullable so still-image / text posts don't carry zeroes that
    // would skew "avg video views" calculations. Watch-time fields
    // store seconds; the UI formats back to "1h 29m" etc.
    videoViews: integer('video_views'),
    watchTimeSeconds: integer('watch_time_seconds'),
    averageWatchTimeSeconds: integer('average_watch_time_seconds'),

    // Stored as numeric so we preserve decimals from the source JSON
    // (e.g. 1.6875). 8 total digits, 4 after the decimal is plenty.
    engagementRate: numeric('engagement_rate', { precision: 8, scale: 4 }),

    // 'official_single_post_analytics' | 'scraped' | 'voyager'
    dataSource: text('data_source').notNull(),

    capturedAt: timestamp('captured_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Upsert key. Lets us "insert or update for this (post, day)".
    postDayUnique: uniqueIndex('post_snapshots_post_day_unique').on(
      table.activityId,
      table.snapshotDate,
    ),
    dateIdx: index('post_snapshots_date_idx').on(table.snapshotDate),
  }),
);

// -------------------------------------------------------------------------
// post_demographics — per-post viewer breakdown, also daily time-series.
// Category is text (not pgEnum) for easier evolution if LinkedIn adds new
// breakdowns. Percentages are stored as numeric (e.g. 35.0 or 0.5 for "<1%").
// -------------------------------------------------------------------------
export const postDemographics = pgTable(
  'post_demographics',
  {
    id: serial('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => posts.activityId, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),

    // 'job_title' | 'location' | 'seniority' | 'company' | 'industry' | 'company_size'
    category: text('category').notNull(),
    value: text('value').notNull(),
    pct: numeric('pct', { precision: 6, scale: 2 }).notNull(),
    rank: integer('rank').notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('post_demographics_unique').on(
      table.activityId,
      table.snapshotDate,
      table.category,
      table.value,
    ),
  }),
);

// -------------------------------------------------------------------------
// post_media — images / videos / carousel slides attached to a post.
// blob_url is where we mirror the asset on Vercel Blob; source_url is the
// original LinkedIn CDN URL (useful if mirroring fails / for diagnostics).
// -------------------------------------------------------------------------
export const postMedia = pgTable(
  'post_media',
  {
    id: serial('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => posts.activityId, { onDelete: 'cascade' }),

    // 'image' | 'video' | 'thumbnail' | 'carousel_slide'
    kind: text('kind').notNull(),

    blobUrl: text('blob_url'),
    sourceUrl: text('source_url').notNull(),

    // 0-based ordering for carousels; 0 for single-media posts.
    position: integer('position').default(0).notNull(),

    width: integer('width'),
    height: integer('height'),

    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    byPost: index('post_media_post_idx').on(table.activityId),
  }),
);

// -------------------------------------------------------------------------
// profile_snapshots — daily rollup of profile-level stats.
// -------------------------------------------------------------------------
export const profileSnapshots = pgTable(
  'profile_snapshots',
  {
    id: serial('id').primaryKey(),
    snapshotDate: date('snapshot_date').notNull().unique(),

    // Both nullable: partial captures are legitimate. A day where the
    // extension only saw connectionsSummary but not a profile page would
    // produce a row with totalConnections set and totalFollowers null,
    // and vice versa. The ingest Zod schema still requires at least one.
    totalFollowers: integer('total_followers'),
    // LinkedIn's 1st-degree connection count, captured from
    // /voyager/api/relationships/connectionsSummary.
    totalConnections: integer('total_connections'),
    followerGrowth12mo: integer('follower_growth_12mo'),
    totalImpressions12mo: integer('total_impressions_12mo'),
    totalEngagements12mo: integer('total_engagements_12mo'),

    capturedAt: timestamp('captured_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

// -------------------------------------------------------------------------
// profile_demographics — audience breakdown for the PROFILE (distinct
// from post_demographics, which is per-post). Currently populated from
// LinkedIn's aggregate analytics export (the AggregateAnalytics xlsx).
// Categories observed: 'Company', 'Industry'. LinkedIn may add more
// (Seniority, Location, etc.) so the column is free-form text.
// -------------------------------------------------------------------------
export const profileDemographics = pgTable(
  'profile_demographics',
  {
    id: serial('id').primaryKey(),
    // The date this demographic snapshot represents. LinkedIn's export
    // doesn't give us daily demographics — each export is a single
    // point-in-time snapshot, so we use the export's end date.
    snapshotDate: date('snapshot_date').notNull(),
    category: text('category').notNull(),
    value: text('value').notNull(),
    pct: numeric('pct', { precision: 6, scale: 2 }).notNull(),
    // Preserves the order the category appeared in the export (1 = top
    // entry within that category). Useful for "top N per category" queries.
    rank: integer('rank'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniq: uniqueIndex('profile_demographics_unique').on(
      table.snapshotDate,
      table.category,
      table.value,
    ),
  }),
);

// -------------------------------------------------------------------------
// daily_engagement — existing daily rollup (impressions + engagements).
// Keyed by date. Independent from post_snapshots aggregates because the
// numbers come from a different LinkedIn view.
// -------------------------------------------------------------------------
export const dailyEngagement = pgTable(
  'daily_engagement',
  {
    date: date('date').primaryKey(),
    impressions: integer('impressions').notNull(),
    engagements: integer('engagements').notNull(),
    // Derived from `date` but stored for readability in ad-hoc SQL queries.
    dayOfWeek: text('day_of_week').notNull(),
  },
);

// -------------------------------------------------------------------------
// ingest_log — one row per extension run. Powers the future /api/health
// endpoint and lets us spot silent failures.
// -------------------------------------------------------------------------
export const ingestLog = pgTable(
  'ingest_log',
  {
    id: serial('id').primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    // 'success' | 'partial' | 'failure'
    status: text('status').notNull(),

    postsCaptured: integer('posts_captured').default(0).notNull(),
    errorMessage: text('error_message'),

    // 'extension-v1' | 'seed' | 'manual'
    source: text('source').notNull(),
  },
);

// -------------------------------------------------------------------------
// User-engagement-on-others tables. Sourced from LinkedIn's "Get a copy
// of your data" complete export (Comments.csv, Reactions.csv,
// Connections.csv). Replaces the filesystem-CSV reads that lived in
// src/lib/data-csv.ts so the data can be refreshed via web upload
// instead of needing to re-extract CSVs into data/linkedin-export/.
// -------------------------------------------------------------------------

// userComments — every comment the account-holder has left on another
// post. Comes from Comments.csv. The link points to the post they
// commented on (not the comment itself; LinkedIn doesn't expose comment
// URNs in the export).
export const userComments = pgTable(
  'user_comments',
  {
    id: serial('id').primaryKey(),
    // Original timestamp from the export (server-side timezone, not always UTC).
    commentedAt: timestamp('commented_at', { withTimezone: true }).notNull(),
    // URL of the post the comment was on (decoded — the export percent-
    // encodes urn:li:activity colons).
    link: text('link').notNull(),
    message: text('message').notNull(),
  },
  (table) => ({
    // Time-series queries (engagement-habits cadence).
    byDate: index('user_comments_date_idx').on(table.commentedAt),
    // Dedup key: same comment shouldn't double-insert across re-imports.
    // Best proxy is (timestamp, link) — comment text can be edited.
    uniq: uniqueIndex('user_comments_unique').on(
      table.commentedAt,
      table.link,
    ),
  }),
);

// userReactions — every reaction the account-holder left on another's
// post. Comes from Reactions.csv.
export const userReactions = pgTable(
  'user_reactions',
  {
    id: serial('id').primaryKey(),
    reactedAt: timestamp('reacted_at', { withTimezone: true }).notNull(),
    // LIKE | PRAISE | EMPATHY | INTEREST | APPRECIATION | ENTERTAINMENT.
    type: text('type').notNull(),
    link: text('link').notNull(),
  },
  (table) => ({
    byDate: index('user_reactions_date_idx').on(table.reactedAt),
    byType: index('user_reactions_type_idx').on(table.type),
    // (timestamp, link, type) — a user could have multiple reactions
    // on the same post at the same second only if LinkedIn allowed
    // re-reacting; using all three keeps re-imports idempotent.
    uniq: uniqueIndex('user_reactions_unique').on(
      table.reactedAt,
      table.link,
      table.type,
    ),
  }),
);

// userConnections — full 1st-degree connections list. Comes from
// Connections.csv. The export has both name parts split, plus URL,
// email (often blank), company, position, and a date in DD MMM YYYY
// format.
export const userConnections = pgTable(
  'user_connections',
  {
    id: serial('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    // Public profile URL — most stable identifier the export gives us.
    profileUrl: text('profile_url').notNull(),
    email: text('email'),
    company: text('company'),
    position: text('position'),
    // Original "17 Dec 2003" string preserved for rendering.
    connectedOnRaw: text('connected_on_raw').notNull(),
    // Parsed ISO date (from connectedOnRaw) for time-series queries.
    connectedAt: date('connected_at'),
  },
  (table) => ({
    // Dedup key — profile URL is the most stable identifier.
    uniq: uniqueIndex('user_connections_unique').on(table.profileUrl),
    byDate: index('user_connections_date_idx').on(table.connectedAt),
  }),
);

// -------------------------------------------------------------------------
// post_analyses — Claude-generated qualitative critique of a post (Phase
// 9.A). One row per analysis run, latest wins for the on-page render.
// We keep history on purpose so that as the skill file evolves we can
// see how the critique drifts.
//
// skillHash captures which version of skills/example-linkedin-writer.md
// was used; the page shows "skill updated since last analysis" when
// the current file's hash differs from the cached row's. Token counts
// land in the same row for cost tracking.
// -------------------------------------------------------------------------
export const postAnalyses = pgTable(
  'post_analyses',
  {
    id: serial('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => posts.activityId, { onDelete: 'cascade' }),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    model: text('model').notNull(),
    skillHash: text('skill_hash').notNull(),
    // The four output sections, all markdown.
    whatWorked: text('what_worked').notNull(),
    whatCouldImprove: text('what_could_improve').notNull(),
    rewriteSuggestions: text('rewrite_suggestions').notNull(),
    lessonToRemember: text('lesson_to_remember').notNull(),
    // Cost tracking — Anthropic returns these in the final usage event.
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    thinkingTokens: integer('thinking_tokens'),
  },
  (table) => ({
    byActivity: index('post_analyses_activity_idx').on(table.activityId),
  }),
);

// Re-export row types so callers get typed inserts/selects for free.
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type PostSnapshot = typeof postSnapshots.$inferSelect;
export type NewPostSnapshot = typeof postSnapshots.$inferInsert;
export type PostDemographic = typeof postDemographics.$inferSelect;
export type NewPostDemographic = typeof postDemographics.$inferInsert;
export type PostMedia = typeof postMedia.$inferSelect;
export type NewPostMedia = typeof postMedia.$inferInsert;
export type ProfileSnapshot = typeof profileSnapshots.$inferSelect;
export type NewProfileSnapshot = typeof profileSnapshots.$inferInsert;
export type ProfileDemographic = typeof profileDemographics.$inferSelect;
export type NewProfileDemographic = typeof profileDemographics.$inferInsert;
export type DailyEngagementRow = typeof dailyEngagement.$inferSelect;
export type NewDailyEngagementRow = typeof dailyEngagement.$inferInsert;
export type IngestLog = typeof ingestLog.$inferSelect;
export type NewIngestLog = typeof ingestLog.$inferInsert;
export type UserComment = typeof userComments.$inferSelect;
export type NewUserComment = typeof userComments.$inferInsert;
export type UserReaction = typeof userReactions.$inferSelect;
export type NewUserReaction = typeof userReactions.$inferInsert;
export type UserConnection = typeof userConnections.$inferSelect;
export type NewUserConnection = typeof userConnections.$inferInsert;
export type PostAnalysis = typeof postAnalyses.$inferSelect;
export type NewPostAnalysis = typeof postAnalyses.$inferInsert;
