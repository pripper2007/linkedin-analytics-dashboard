import type { Post, PostMetrics, TopicMetrics, FeatureImpact, DailyEntry } from './types';
import { ANALYTICS_TIMEZONE } from './site-config';

export function calculatePostMetrics(posts: Post[]): PostMetrics {
  const total = posts.length;
  if (total === 0) {
    return {
      avgImpressions: 0, avgEngagementRate: 0, avgReactions: 0,
      avgComments: 0, avgFollowersGained: 0, avgEngagements: 0, totalImpressions: 0,
      totalEngagements: 0, topPostByImpressions: posts[0],
      topPostByEngagement: posts[0], topPostByFollowers: posts[0],
    };
  }

  const totalImpressions = posts.reduce((s, p) => s + p.impressions, 0);
  const totalEngagements = posts.reduce((s, p) => s + p.social_engagements, 0);

  return {
    avgImpressions: Math.round(totalImpressions / total),
    avgEngagementRate: Number((posts.reduce((s, p) => s + p.engagement_rate, 0) / total).toFixed(2)),
    avgReactions: Math.round(posts.reduce((s, p) => s + p.reactions, 0) / total),
    avgComments: Math.round(posts.reduce((s, p) => s + p.comments, 0) / total),
    avgFollowersGained: Math.round(posts.reduce((s, p) => s + p.followers_gained, 0) / total),
    avgEngagements: Math.round(totalEngagements / total),
    totalImpressions,
    totalEngagements,
    topPostByImpressions: [...posts].sort((a, b) => b.impressions - a.impressions)[0],
    topPostByEngagement: [...posts].sort((a, b) => b.engagement_rate - a.engagement_rate)[0],
    topPostByFollowers: [...posts].sort((a, b) => b.followers_gained - a.followers_gained)[0],
  };
}

export function calculateTopicMetrics(posts: Post[]): TopicMetrics[] {
  const topicMap = new Map<string, Post[]>();
  posts.forEach(p => {
    const arr = topicMap.get(p.topic) || [];
    arr.push(p);
    topicMap.set(p.topic, arr);
  });

  return Array.from(topicMap.entries()).map(([topic, topicPosts]) => ({
    topic,
    count: topicPosts.length,
    avgImpressions: Math.round(topicPosts.reduce((s, p) => s + p.impressions, 0) / topicPosts.length),
    avgEngagementRate: Number((topicPosts.reduce((s, p) => s + p.engagement_rate, 0) / topicPosts.length).toFixed(2)),
    avgFollowersGained: Math.round(topicPosts.reduce((s, p) => s + p.followers_gained, 0) / topicPosts.length),
    totalImpressions: topicPosts.reduce((s, p) => s + p.impressions, 0),
  })).sort((a, b) => b.avgImpressions - a.avgImpressions);
}

export function calculateFeatureImpact(posts: Post[]): FeatureImpact[] {
  const features: { key: keyof Post; label: string }[] = [
    { key: 'has_image', label: 'Image' },
    { key: 'has_link', label: 'External Link' },
    { key: 'has_bold_unicode', label: 'Bold Unicode' },
    { key: 'has_emoji', label: 'Emoji' },
    { key: 'has_bullet_points', label: 'Bullet Points' },
    { key: 'has_question', label: 'Question' },
  ];

  return features.map(({ key, label }) => {
    const withF = posts.filter(p => p[key] === true);
    const withoutF = posts.filter(p => p[key] === false);
    const avgWith = withF.length ? Math.round(withF.reduce((s, p) => s + p.impressions, 0) / withF.length) : 0;
    const avgWithout = withoutF.length ? Math.round(withoutF.reduce((s, p) => s + p.impressions, 0) / withoutF.length) : 0;
    const impactPct = avgWithout > 0 ? Math.round(((avgWith - avgWithout) / avgWithout) * 100) : 0;

    return {
      feature: label,
      withFeature: {
        count: withF.length,
        avgImpressions: avgWith,
        avgEngagement: withF.length ? Number((withF.reduce((s, p) => s + p.engagement_rate, 0) / withF.length).toFixed(2)) : 0,
      },
      withoutFeature: {
        count: withoutF.length,
        avgImpressions: avgWithout,
        avgEngagement: withoutF.length ? Number((withoutF.reduce((s, p) => s + p.engagement_rate, 0) / withoutF.length).toFixed(2)) : 0,
      },
      impactPct,
    };
  }).sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
}

export function calculateStyleMetrics(posts: Post[]): TopicMetrics[] {
  const styleMap = new Map<string, Post[]>();
  posts.forEach(p => {
    const arr = styleMap.get(p.style) || [];
    arr.push(p);
    styleMap.set(p.style, arr);
  });

  return Array.from(styleMap.entries()).map(([style, stylePosts]) => ({
    topic: style,
    count: stylePosts.length,
    avgImpressions: Math.round(stylePosts.reduce((s, p) => s + p.impressions, 0) / stylePosts.length),
    avgEngagementRate: Number((stylePosts.reduce((s, p) => s + p.engagement_rate, 0) / stylePosts.length).toFixed(2)),
    avgFollowersGained: Math.round(stylePosts.reduce((s, p) => s + p.followers_gained, 0) / stylePosts.length),
    totalImpressions: stylePosts.reduce((s, p) => s + p.impressions, 0),
  })).sort((a, b) => b.avgImpressions - a.avgImpressions);
}

export function calculateFeatureStackingImpact(posts: Post[]): { featureCount: number; avgImpressions: number; avgEngagement: number; count: number }[] {
  const groups = new Map<number, Post[]>();
  posts.forEach(p => {
    const arr = groups.get(p.feature_count) || [];
    arr.push(p);
    groups.set(p.feature_count, arr);
  });

  return Array.from(groups.entries())
    .map(([featureCount, groupPosts]) => ({
      featureCount,
      avgImpressions: Math.round(groupPosts.reduce((s, p) => s + p.impressions, 0) / groupPosts.length),
      avgEngagement: Number((groupPosts.reduce((s, p) => s + p.engagement_rate, 0) / groupPosts.length).toFixed(2)),
      count: groupPosts.length,
    }))
    .sort((a, b) => a.featureCount - b.featureCount);
}

export function calculateWordCountBuckets(posts: Post[]): { range: string; avgImpressions: number; count: number }[] {
  const buckets: { min: number; max: number; label: string }[] = [
    { min: 0, max: 100, label: '0-100' },
    { min: 101, max: 150, label: '101-150' },
    { min: 151, max: 200, label: '151-200' },
    { min: 201, max: 300, label: '201-300' },
    { min: 301, max: 500, label: '301-500' },
    { min: 501, max: Infinity, label: '500+' },
  ];

  return buckets.map(b => {
    const bPosts = posts.filter(p => p.word_count >= b.min && p.word_count <= b.max);
    return {
      range: b.label,
      avgImpressions: bPosts.length ? Math.round(bPosts.reduce((s, p) => s + p.impressions, 0) / bPosts.length) : 0,
      count: bPosts.length,
    };
  }).filter(b => b.count > 0);
}

export function calculateEarnedMediaValue(impressions: number, engagements: number): { cpmValue: number; cpcValue: number } {
  // LinkedIn average CPM: ~$6.59, average CPC: ~$5.26 (2024/2025 benchmarks)
  const LINKEDIN_CPM = 6.59;
  const LINKEDIN_CPC = 5.26;
  return {
    cpmValue: Number(((impressions / 1000) * LINKEDIN_CPM).toFixed(2)),
    cpcValue: Number((engagements * LINKEDIN_CPC).toFixed(2)),
  };
}

export function calculateMonthlyData(dailyData: DailyEntry[]): { month: string; impressions: number; engagements: number; avgDaily: number }[] {
  const monthMap = new Map<string, DailyEntry[]>();
  dailyData.forEach(d => {
    const month = d.date.substring(0, 7); // "2025-04"
    const arr = monthMap.get(month) || [];
    arr.push(d);
    monthMap.set(month, arr);
  });

  return Array.from(monthMap.entries())
    .map(([month, entries]) => ({
      month,
      impressions: entries.reduce((s, e) => s + e.impressions, 0),
      engagements: entries.reduce((s, e) => s + e.engagements, 0),
      avgDaily: Math.round(entries.reduce((s, e) => s + e.impressions, 0) / entries.length),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Per-post posting heatmap: day-of-week × time-of-day.
 *
 * Time-of-day buckets (Brazilian convention, time in São Paulo / BRT):
 *   - Manhã  06h–12h
 *   - Tarde  12h–18h
 *   - Noite  18h–06h (next day, includes madrugada)
 *
 * Returns one cell per (day, bucket) intersection, even when empty —
 * so the consumer gets a stable 7×3 grid suitable for a heatmap render.
 *
 * Why this lives next to calculateDayOfWeekMetrics: the existing
 * day-of-week breakdown comes from `daily_engagement` (which has no
 * per-post timestamps and therefore no clock data). The heatmap needs
 * the actual `posted_at` timestamp from each post, which is why it
 * takes `Post[]` rather than `DailyEntry[]`. The two calculations
 * intentionally don't share a code path.
 */

export type PostingHeatmapBucket = 'Manhã' | 'Tarde' | 'Noite';
export const POSTING_HEATMAP_BUCKETS: PostingHeatmapBucket[] = [
  'Manhã',
  'Tarde',
  'Noite',
];

const POSTING_DAY_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export interface PostingHeatmapCell {
  day: typeof POSTING_DAY_ORDER[number];
  bucket: PostingHeatmapBucket;
  avgImpressions: number;
  avgEngagementRate: number;
  count: number;
}

/** Convert a São Paulo–local hour (0–23) to one of the three buckets. */
function bucketForHour(h: number): PostingHeatmapBucket {
  if (h >= 6 && h < 12) return 'Manhã';
  if (h >= 12 && h < 18) return 'Tarde';
  return 'Noite';
}

/**
 * Read a Post's posted_at in the configured ANALYTICS_TIMEZONE. We rebuild
 * the date with that IANA zone via Intl.DateTimeFormat so the weekday/hour
 * bucket stays honest regardless of where the dashboard is rendered.
 */
function localZonedParts(d: Date): { day: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIMEZONE,
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const day = parts.find((p) => p.type === 'weekday')?.value ?? 'Monday';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // Intl reports "24" for midnight in some implementations — normalize.
  const h = Number(hourRaw) % 24;
  return { day, hour: Number.isFinite(h) ? h : 0 };
}

export function calculatePostingHeatmap(posts: Post[]): PostingHeatmapCell[] {
  // Initialize every (day, bucket) cell so the consumer always renders
  // a complete 7×3 grid without "missing cell" branches.
  const cells = new Map<string, Post[]>();
  for (const day of POSTING_DAY_ORDER) {
    for (const bucket of POSTING_HEATMAP_BUCKETS) {
      cells.set(`${day}|${bucket}`, []);
    }
  }

  for (const p of posts) {
    const dt = new Date(`${p.post_date} ${p.publish_time} UTC`);
    if (Number.isNaN(dt.getTime())) continue;
    const { day, hour } = localZonedParts(dt);
    const bucket = bucketForHour(hour);
    const key = `${day}|${bucket}`;
    const arr = cells.get(key);
    if (arr) arr.push(p);
  }

  const out: PostingHeatmapCell[] = [];
  for (const day of POSTING_DAY_ORDER) {
    for (const bucket of POSTING_HEATMAP_BUCKETS) {
      const bucketPosts = cells.get(`${day}|${bucket}`) ?? [];
      const n = bucketPosts.length;
      out.push({
        day,
        bucket,
        avgImpressions: n
          ? Math.round(bucketPosts.reduce((s, p) => s + p.impressions, 0) / n)
          : 0,
        avgEngagementRate: n
          ? Number(
              (
                bucketPosts.reduce((s, p) => s + p.engagement_rate, 0) / n
              ).toFixed(2),
            )
          : 0,
        count: n,
      });
    }
  }
  return out;
}

/**
 * Per-post day-of-week aggregate. Same data source as the posting heatmap
 * (`posts` array, ANALYTICS_TIMEZONE) — so the per-day numbers reconcile
 * exactly with the (day, bucket) cells: each day's avgImpressions is the
 * count-weighted average of its three buckets.
 *
 * Distinct from `calculateDayOfWeekMetrics`, which averages the
 * `daily_engagement` rollup (impressions per CALENDAR DAY, including
 * days with no post). That metric dilutes by no-post days and produces
 * numbers that don't reconcile with per-post averages — kept around for
 * pages that want the calendar-day view (home, earned-media, growth).
 */
export function calculatePerPostDayOfWeek(posts: Post[]): { day: string; avgImpressions: number; avgEngagements: number; count: number }[] {
  const buckets = new Map<string, Post[]>();
  for (const day of POSTING_DAY_ORDER) buckets.set(day, []);

  for (const p of posts) {
    const dt = new Date(`${p.post_date} ${p.publish_time} UTC`);
    if (Number.isNaN(dt.getTime())) continue;
    const { day } = localZonedParts(dt);
    buckets.get(day)?.push(p);
  }

  return POSTING_DAY_ORDER.map((day) => {
    const dayPosts = buckets.get(day) ?? [];
    const n = dayPosts.length;
    return {
      day,
      avgImpressions: n
        ? Math.round(dayPosts.reduce((s, p) => s + p.impressions, 0) / n)
        : 0,
      avgEngagements: n
        ? Math.round(dayPosts.reduce((s, p) => s + p.social_engagements, 0) / n)
        : 0,
      count: n,
    };
  });
}

export function calculateDayOfWeekMetrics(dailyData: DailyEntry[]): { day: string; avgImpressions: number; avgEngagements: number; count: number }[] {
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayMap = new Map<string, DailyEntry[]>();
  dailyData.forEach(d => {
    const arr = dayMap.get(d.day_of_week) || [];
    arr.push(d);
    dayMap.set(d.day_of_week, arr);
  });

  return dayOrder.map(day => {
    const entries = dayMap.get(day) || [];
    return {
      day,
      avgImpressions: entries.length ? Math.round(entries.reduce((s, e) => s + e.impressions, 0) / entries.length) : 0,
      avgEngagements: entries.length ? Math.round(entries.reduce((s, e) => s + e.engagements, 0) / entries.length) : 0,
      count: entries.length,
    };
  });
}

export function aggregateDemographics(posts: Post[]): {
  job_title: Map<string, number>;
  location: Map<string, number>;
  seniority: Map<string, number>;
  company: Map<string, number>;
  industry: Map<string, number>;
  company_size: Map<string, number>;
} {
  const result = {
    job_title: new Map<string, number>(),
    location: new Map<string, number>(),
    seniority: new Map<string, number>(),
    company: new Map<string, number>(),
    industry: new Map<string, number>(),
    company_size: new Map<string, number>(),
  };

  const postsWithDemo = posts.filter(p => p.demographics !== null);
  if (postsWithDemo.length === 0) return result;

  const categories = ['job_title', 'location', 'seniority', 'company', 'industry', 'company_size'] as const;

  categories.forEach(cat => {
    const aggregated = new Map<string, number[]>();
    postsWithDemo.forEach(p => {
      if (!p.demographics) return;
      p.demographics[cat].forEach(entry => {
        const pctVal = parseFloat(entry.pct.replace('%', '').replace('<', '').replace('< ', '').trim()) || 0.5;
        const arr = aggregated.get(entry.value) || [];
        arr.push(pctVal);
        aggregated.set(entry.value, arr);
      });
    });

    aggregated.forEach((vals, key) => {
      result[cat].set(key, Number((vals.reduce((s, v) => s + v, 0) / postsWithDemo.length).toFixed(1)));
    });
  });

  return result;
}

export function parsePct(pct: string): number {
  return parseFloat(pct.replace('%', '').replace('<', '').replace('< ', '').trim()) || 0.5;
}

/**
 * Same shape as aggregateDemographics, but estimated absolute member counts
 * instead of average %. For each post with demographics:
 *   estimated_reach = (pct / 100) × members_reached
 * Then summed across all posts. This is a "total impressions to segment"
 * estimate — the best absolute number we can derive from per-post % rows.
 * Note: a person who sees multiple of your posts is counted multiple times.
 */
export function aggregateDemographicsAbsolute(posts: Post[]): {
  job_title: Map<string, number>;
  location: Map<string, number>;
  seniority: Map<string, number>;
  company: Map<string, number>;
  industry: Map<string, number>;
  company_size: Map<string, number>;
} {
  const result = {
    job_title: new Map<string, number>(),
    location: new Map<string, number>(),
    seniority: new Map<string, number>(),
    company: new Map<string, number>(),
    industry: new Map<string, number>(),
    company_size: new Map<string, number>(),
  };

  const postsWithDemo = posts.filter(p => p.demographics !== null && p.members_reached > 0);
  if (postsWithDemo.length === 0) return result;

  const categories = ['job_title', 'location', 'seniority', 'company', 'industry', 'company_size'] as const;

  categories.forEach(cat => {
    const totals = new Map<string, number>();
    postsWithDemo.forEach(p => {
      if (!p.demographics) return;
      p.demographics[cat].forEach(entry => {
        const pct = parsePct(entry.pct);
        const reach = (pct / 100) * p.members_reached;
        totals.set(entry.value, (totals.get(entry.value) ?? 0) + reach);
      });
    });
    totals.forEach((v, k) => result[cat].set(k, Math.round(v)));
  });

  return result;
}

export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

/**
 * Unicode-safe text truncation.
 *
 * `string.substring(0, 80)` operates on UTF-16 code units, which can
 * cut in the middle of a surrogate pair for characters outside the
 * Basic Multilingual Plane — emoji, flag sequences, mathematical bold
 * letters (which appear in a lot of LinkedIn post headings), etc.
 * The browser renders the orphaned surrogate as U+FFFD (�) and the
 * truncation looks corrupted.
 *
 * `Array.from(str)` iterates by code POINT, preserving surrogate
 * pairs as single elements. That handles the common case (emoji,
 * mathematical bold). Combining-mark sequences still have a small
 * residual risk — fine for now; we'd need Intl.Segmenter for perfect
 * grapheme handling and the current gap is visible enough to wait on.
 */
export function truncateChars(s: string, maxChars: number, ellipsis = '...'): string {
  if (!s) return '';
  const chars = Array.from(s);
  if (chars.length <= maxChars) return s;
  return chars.slice(0, maxChars).join('') + ellipsis;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
