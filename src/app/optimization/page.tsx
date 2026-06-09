import {
  calculateFeatureImpact,
  calculateFeatureStackingImpact,
  calculateWordCountBuckets,
  calculateTopicMetrics,
  calculateStyleMetrics,
  calculatePerPostDayOfWeek,
  calculatePostingHeatmap,
} from '@/lib/calculations';
import { getAllPosts } from '@/lib/queries';
import FeatureImpactChart from '@/components/charts/FeatureImpactChart';
import FeatureStackingChart from '@/components/charts/FeatureStackingChart';
import WordCountChart from '@/components/charts/WordCountChart';
import TopicPerformanceChart from '@/components/charts/TopicPerformanceChart';
import StylePerformanceChart from '@/components/charts/StylePerformanceChart';
import DayHourPerformance from '@/components/charts/DayHourPerformance';

export const metadata = {
  title: 'Content Optimization Engine',
  description: 'Data-driven insights on what content features drive performance',
};
export const dynamic = 'force-dynamic';

export default async function OptimizationPage() {
  const allPosts = await getAllPosts();

  // Quality filter for correlation analyses (Phase 3 calibration):
  //
  //   1. impressions >= MIN_IMPRESSIONS — drop posts that technically have
  //      a snapshot but barely-any reach. These are usually fresh posts
  //      where LinkedIn hasn't tallied yet, and they pull every average
  //      toward zero in unhelpful ways.
  //
  //   2. posted_at within the last WINDOW_MONTHS — older posts ran under
  //      a different LinkedIn algorithm (and a different Pedro), so
  //      including them muddles the signal we'd act on today.
  //
  // Bucket-level honesty (n>=MIN_BUCKET) is enforced inside the chart
  // components — they paint a "low confidence" badge on bars whose with-
  // or without-feature group is too thin to trust.
  const MIN_IMPRESSIONS = 100;
  const WINDOW_MONTHS = 18;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - WINDOW_MONTHS);
  const cutoffMs = cutoff.getTime();
  const posts = allPosts.filter((p) => {
    if (p.impressions < MIN_IMPRESSIONS) return false;
    const postedMs = new Date(`${p.post_date} ${p.publish_time} UTC`).getTime();
    return Number.isFinite(postedMs) && postedMs >= cutoffMs;
  });

  // Universe stats — surfaced at the top of the page so it's clear what
  // sample these averages are computed against.
  const postedDates = posts
    .map((p) => new Date(`${p.post_date} ${p.publish_time} UTC`).getTime())
    .filter((t) => Number.isFinite(t));
  const earliest = postedDates.length ? new Date(Math.min(...postedDates)) : null;
  const latest = postedDates.length ? new Date(Math.max(...postedDates)) : null;
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  const droppedTooFewImpressions = allPosts.filter(
    (p) => {
      const postedMs = new Date(`${p.post_date} ${p.publish_time} UTC`).getTime();
      return (
        Number.isFinite(postedMs) &&
        postedMs >= cutoffMs &&
        p.impressions < MIN_IMPRESSIONS
      );
    },
  ).length;
  const droppedOutsideWindow = allPosts.length - posts.length - droppedTooFewImpressions;

  const featureImpact = calculateFeatureImpact(posts);
  const featureStacking = calculateFeatureStackingImpact(posts);
  const wordCountBuckets = calculateWordCountBuckets(posts);
  const topicMetrics = calculateTopicMetrics(posts);
  const styleMetrics = calculateStyleMetrics(posts);
  // Bars and heatmap below share a single per-post source so the numbers
  // reconcile (each day's bar equals the count-weighted average of its
  // three buckets). Earlier version mixed daily_engagement rollup (bars)
  // with per-post averages (cells) — units didn't match.
  const dayOfWeekMetrics = calculatePerPostDayOfWeek(posts);
  const postingHeatmap = calculatePostingHeatmap(posts);

  // Find best day of week
  const bestDay = dayOfWeekMetrics
    .filter(d => d.count > 0)
    .sort((a, b) => b.avgImpressions - a.avgImpressions)[0];

  // Find best word count bucket
  const bestWordCountBucket = wordCountBuckets.sort((a, b) => b.avgImpressions - a.avgImpressions)[0];

  // Find image impact
  const imageFeature = featureImpact.find(f => f.feature === 'Image');
  const questionsFeature = featureImpact.find(f => f.feature === 'Question');

  // Best day×bucket cell with at least 3 posts (signal threshold).
  const bestSlot = postingHeatmap
    .filter((c) => c.count >= 3)
    .sort((a, b) => b.avgImpressions - a.avgImpressions)[0];

  return (
    <div className="min-h-screen bg-primary p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Content Optimization Engine
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Data-driven insights on what content features drive performance
          </p>
        </div>

        {/* Universe-of-posts callout — every chart on this page averages
            across the same filtered set, so we make that set explicit
            up-front rather than burying the rules in chart footnotes. */}
        <div
          className="card mb-8"
          style={{ borderLeft: '3px solid var(--accent)' }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-4 mb-3">
            <h3 className="section-title mb-0">Posts analyzed</h3>
            <span
              className="text-2xl font-bold"
              style={{ color: 'var(--accent)' }}
            >
              {posts.length}
            </span>
          </div>
          <p
            className="text-sm mb-3"
            style={{ color: 'var(--text-secondary)' }}
          >
            {earliest && latest ? (
              <>
                From <strong>{fmtDate(earliest)}</strong> to{' '}
                <strong>{fmtDate(latest)}</strong>. Out of{' '}
                {allPosts.length.toLocaleString()} total posts in the database,{' '}
                {droppedOutsideWindow.toLocaleString()} fall outside the {WINDOW_MONTHS}
                -month window and {droppedTooFewImpressions.toLocaleString()} have
                fewer than {MIN_IMPRESSIONS.toLocaleString()} impressions captured.
              </>
            ) : (
              <>No posts match the current filter.</>
            )}
          </p>
          <details className="text-xs" style={{ color: 'var(--text-muted)' }}>
            <summary
              className="cursor-pointer font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              How to grow this sample
            </summary>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>
                <strong>Capture more analytics</strong> — open each recent post on
                LinkedIn and let the browser extension grab the in-app analytics
                drawer. Posts without captured analytics show 0 impressions and
                get filtered out.
              </li>
              <li>
                <strong>Post more often</strong> — only the last {WINDOW_MONTHS}{' '}
                months are included (older posts ran under different LinkedIn
                ranking rules and would muddy the signal).
              </li>
              <li>
                <strong>Lower the impression floor</strong> — currently set at{' '}
                {MIN_IMPRESSIONS.toLocaleString()}. Posts below this threshold are
                usually too fresh for LinkedIn to have tallied yet, but the floor
                can be tuned in <code>src/app/optimization/page.tsx</code> if
                you&apos;d rather include them.
              </li>
            </ul>
          </details>
        </div>

        {/* Section 0: Headline takeaways — surfaced at the top because
            this is the part you act on (the rest of the page is the
            evidence). 5 cards: Image / Question / Sweet Spot / Best Day
            / Best Slot. Best Slot pulls from the day×hour heatmap and
            requires n>=3 in that cell so it's not a single-post fluke. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {imageFeature && (
            <div className="card">
              <p className="metric-label mb-2">Image Impact</p>
              <p className="metric-value text-2xl">
                {imageFeature.impactPct >= 0 ? '+' : ''}
                {imageFeature.impactPct}%
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Impressions vs. posts without an image
              </p>
            </div>
          )}

          {questionsFeature && (
            <div className="card">
              <p className="metric-label mb-2">Question Impact</p>
              <p className="metric-value text-2xl">
                {questionsFeature.impactPct >= 0 ? '+' : ''}
                {questionsFeature.impactPct}%
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Impressions vs. posts without a question
              </p>
            </div>
          )}

          {bestWordCountBucket && (
            <div className="card">
              <p className="metric-label mb-2">Sweet Spot</p>
              <p className="metric-value text-2xl">
                {bestWordCountBucket.range}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Best-performing word-count range
              </p>
            </div>
          )}

          {bestDay && (
            <div className="card">
              <p className="metric-label mb-2">Best Day</p>
              <p className="metric-value text-2xl">{bestDay.day}</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {bestDay.avgImpressions.toLocaleString()} avg/post · n=
                {bestDay.count}
              </p>
            </div>
          )}

          {bestSlot && (
            <div className="card">
              <p className="metric-label mb-2">Best Slot</p>
              <p className="metric-value text-2xl">
                {bestSlot.day.slice(0, 3)} · {bestSlot.bucket}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {bestSlot.avgImpressions.toLocaleString()} avg · n=
                {bestSlot.count}
              </p>
            </div>
          )}
        </div>

        {/* Section 1: Feature Impact Analysis */}
        <div className="mb-8">
          <FeatureImpactChart data={featureImpact} />
        </div>

        {/* Section 2: Feature Stacking & Word Count */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <FeatureStackingChart data={featureStacking} />
          <WordCountChart data={wordCountBuckets} />
        </div>

        {/* Section 3: Topic & Style Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <TopicPerformanceChart data={topicMetrics} />
          <StylePerformanceChart data={styleMetrics} />
        </div>

        {/* Section 4: One coherent "when to post" view — bar chart on top
            (avg impressions per post by day-of-week) with a heatmap below
            sharing the same 7-column grid (day × time-of-day). Both are
            sourced from the same per-post data, so each day's bar equals
            the count-weighted average of its three buckets — bars and
            cells reconcile arithmetically. */}
        <div className="mb-8">
          <DayHourPerformance
            heatmap={postingHeatmap}
            dayOfWeek={dayOfWeekMetrics}
          />
        </div>

      </div>
    </div>
  );
}
