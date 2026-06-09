import React from 'react';
import type { IngestHealth } from '@/lib/queries';
import {
  getProfile,
  getDailyEngagement,
  getAllPosts,
  getFollowerHistory,
  getIngestHealth,
} from '@/lib/queries';
import {
  calculatePostMetrics,
  calculateMonthlyData,
  formatNumber,
} from '@/lib/calculations';
import { resolveRange, bucketsForRange } from '@/lib/date-range';
import { pearson } from '@/lib/stats';
import { buildAllModes } from '@/lib/progress-report';
import { MetricCard } from '@/components/cards/MetricCard';
import ProgressReport from '@/components/dashboard/ProgressReport';
import { StaleDataBanner } from '@/components/dashboard/StaleDataBanner';
import { RangeFilter } from './RangeFilter';
import { RangeCharts } from './RangeCharts';
import type { FollowersPoint } from '@/components/charts/FollowersRangeChart';
import type { ImpressionsPoint } from '@/components/charts/ImpressionsRangeChart';
import type { EngagementPoint } from '@/components/charts/EngagementRangeChart';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { range?: string; from?: string; to?: string };
}) {
  const range = resolveRange(searchParams ?? {});

  const [profile, dailyEngagementAll, postsAll, followerHistory, ingestHealth] =
    await Promise.all([
      getProfile(),
      getDailyEngagement(),
      getAllPosts(),
      getFollowerHistory(),
      getIngestHealth(),
    ]);

  // --- Window the data --------------------------------------------------
  const dailyEngagement = dailyEngagementAll.filter(
    (d) => d.date >= range.fromIso && d.date <= range.toIso,
  );

  // Posts within the window — post_date is "M/D/YYYY" from the legacy
  // adapter, so parse + compare against the UTC window boundaries.
  const posts = postsAll.filter((p) => {
    const d = new Date(p.post_date);
    if (isNaN(d.getTime())) return false;
    return d >= range.from && d <= range.to;
  });

  // Averages (per-post) only make sense for posts we actually have
  // analytics for. Historical Shares.csv imports don't have snapshots,
  // so their impressions are 0 — including them would dilute averages.
  const postsWithMetrics = posts.filter((p) => p.impressions > 0);
  const metrics = calculatePostMetrics(postsWithMetrics);

  // Windowed totals come from daily_engagement (the authoritative
  // LinkedIn rollups), NOT from summing per-post impressions — per-post
  // only covers what we've captured and would under-report.
  const totalImpressions = dailyEngagement.reduce(
    (s, d) => s + d.impressions,
    0,
  );
  const totalEngagements = dailyEngagement.reduce(
    (s, d) => s + d.engagements,
    0,
  );
  const avgEngagementRate =
    totalImpressions > 0
      ? ((totalEngagements / totalImpressions) * 100).toFixed(2)
      : '0.00';

  // Follower growth within the window: latest history point strictly
  // BEFORE `from` → start baseline; latest point on or before `to` →
  // end. Using `< from` (not `<=`) means growth is measured "during"
  // the window. If no earlier point exists (range predates our history)
  // we leave growth null so the UI can show "—" rather than inflated.
  const startAnchor = [...followerHistory]
    .filter((p) => p.date < range.fromIso)
    .pop();
  const endAnchor = [...followerHistory]
    .filter((p) => p.date <= range.toIso)
    .pop();
  const followerGrowth =
    startAnchor && endAnchor
      ? endAnchor.total_followers - startAnchor.total_followers
      : null;
  const followerGrowthPercent =
    startAnchor && endAnchor && startAnchor.total_followers > 0
      ? (
          ((endAnchor.total_followers - startAnchor.total_followers) /
            startAnchor.total_followers) *
          100
        ).toFixed(1)
      : null;

  // Monthly breakdown — built from windowed daily data, so only shows
  // months that intersect the selected range.
  const monthlyData = calculateMonthlyData(dailyEngagement);
  function monthlyRate(m: (typeof monthlyData)[number]): number {
    return m.impressions > 0 ? m.engagements / m.impressions : 0;
  }

  // New followers per month. For month M, anchor = latest follower_history
  // point strictly before the 1st of M; end = latest point on/in M. Diff
  // is net followers added during M. Null when either anchor is missing
  // (usually means the month pre-dates our follower_history backfill).
  function newFollowersInMonth(month: string): number | null {
    const [y, m] = month.split('-').map(Number);
    const firstIso = `${month}-01`;
    const nextFirstIso = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const start = [...followerHistory].filter((p) => p.date < firstIso).pop();
    const end = [...followerHistory]
      .filter((p) => p.date >= firstIso && p.date < nextFirstIso)
      .pop();
    if (!start || !end) return null;
    return end.total_followers - start.total_followers;
  }

  // "Best month" = the month that grew the network most. Correlation
  // analysis in scripts/_tmp-correlation.ts (n=38 posts) showed raw
  // follower growth is the real outcome metric; engagement rate alone
  // has near-zero predictive power (r=0.06). Engagement rate used as
  // tiebreaker when two months tie on follower gain.
  const bestMonth =
    monthlyData.length > 0
      ? monthlyData.reduce((prev, curr) => {
          const gc = newFollowersInMonth(curr.month) ?? -Infinity;
          const gp = newFollowersInMonth(prev.month) ?? -Infinity;
          if (gc !== gp) return gc > gp ? curr : prev;
          return monthlyRate(curr) > monthlyRate(prev) ? curr : prev;
        })
      : null;
  const highlightBest = monthlyData.length >= 2;

  // Posts-per-month lookup (windowed posts only).
  const postsPerMonth = new Map<string, number>();
  posts.forEach((post) => {
    const d = new Date(post.post_date);
    if (isNaN(d.getTime())) return;
    const month = d.toISOString().substring(0, 7);
    postsPerMonth.set(month, (postsPerMonth.get(month) || 0) + 1);
  });

  // Per-month daily_engagement coverage. The XLSX import is the only feed
  // for engagements + total impressions, and LinkedIn's export tool only
  // emits user-selected windows (last 7d / 14d / 30d / custom). When a
  // user re-imports a narrow window, a month can end up with internal
  // gaps. Engagement Rate and Impressions/Post are computed on whatever
  // days do exist — so a month with 9 of 21 expected days silently
  // produces a value that LOOKS comparable but isn't. Flag those rows.
  const dailyEngagementDateSet = new Set(dailyEngagement.map((d) => d.date));
  // Latest date present anywhere in the window — informs the footnote.
  const dailyEngagementLastDate =
    dailyEngagement.length > 0
      ? dailyEngagement[dailyEngagement.length - 1].date
      : null;
  // Today (UTC) clamps the "expected" coverage — partial-current-month is
  // expected, not stale. We only want to flag missing-day gaps within the
  // already-elapsed portion of the month.
  const todayIsoUtc = new Date().toISOString().slice(0, 10);
  function monthCoverage(
    month: string,
  ): { actual: number; expected: number } | null {
    const [yy, mm] = month.split('-').map(Number);
    const lastDayUtc = new Date(Date.UTC(yy, mm, 0))
      .toISOString()
      .slice(0, 10);
    const expectedEnd = lastDayUtc < todayIsoUtc ? lastDayUtc : todayIsoUtc;
    let expected = 0;
    let actual = 0;
    for (
      let d = new Date(`${month}-01T00:00:00Z`);
      d.toISOString().slice(0, 10) <= expectedEnd;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      expected++;
      if (dailyEngagementDateSet.has(d.toISOString().slice(0, 10))) actual++;
    }
    if (actual >= expected) return null;
    return { actual, expected };
  }
  // Build the per-row partial map once for both desktop + mobile renders.
  const monthCoverageMap = new Map<
    string,
    { actual: number; expected: number }
  >();
  for (const row of monthlyData) {
    const c = monthCoverage(row.month);
    if (c) monthCoverageMap.set(row.month, c);
  }
  const anyMonthIsPartial = monthCoverageMap.size > 0;

  // --- Chart series: Followers / Impressions / Engagement ------------------
  //
  // Build both "per period" and "cumulative" shapes up front so the
  // client-side toggle is a pure array swap — no extra round-trip, no
  // loading state. Bucketing rule lives in date-range.ts: daily when
  // the window is ≤ 7 days, weekly otherwise.

  const { size: bucketSize, buckets } = bucketsForRange(range);

  // Fast lookups into daily data + per-day post counts.
  const dailyByDate = new Map(dailyEngagementAll.map((d) => [d.date, d]));
  const postsByIso = new Map<string, number>();
  for (const p of posts) {
    const d = new Date(p.post_date);
    if (isNaN(d.getTime())) continue;
    const iso = d.toISOString().slice(0, 10);
    postsByIso.set(iso, (postsByIso.get(iso) ?? 0) + 1);
  }

  // follower_history may have gaps (we don't write a row every day).
  // For any given date, we want the most recent known total_followers
  // on or before that date.
  const followerPointsAsc = [...followerHistory]; // already sorted asc
  function followersAsOf(iso: string): number | null {
    let last: number | null = null;
    for (const p of followerPointsAsc) {
      if (p.date <= iso) last = p.total_followers;
      else break;
    }
    return last;
  }

  const followerPerPeriod: FollowersPoint[] = [];
  const followerCumulative: FollowersPoint[] = [];
  const impressionsPerPeriod: ImpressionsPoint[] = [];
  const impressionsCumulative: ImpressionsPoint[] = [];
  const engagementPerPeriod: EngagementPoint[] = [];
  const engagementCumulative: EngagementPoint[] = [];

  let runningImpr = 0;
  let runningEng = 0;
  let runningPosts = 0;
  let runningFollowerGain = 0;

  // One pass over the buckets — aggregate impressions/engagements from
  // daily_engagement rows, posts from postsByIso, and followers from
  // the diff of follower_history endpoints around each bucket.
  for (const b of buckets) {
    let bucketImpr = 0;
    let bucketEng = 0;
    let bucketPosts = 0;
    let cursor = new Date(`${b.startIso}T00:00:00Z`);
    const endDate = new Date(`${b.endIso}T00:00:00Z`);
    while (cursor <= endDate) {
      const iso = cursor.toISOString().slice(0, 10);
      const row = dailyByDate.get(iso);
      if (row) {
        bucketImpr += row.impressions;
        bucketEng += row.engagements;
      }
      bucketPosts += postsByIso.get(iso) ?? 0;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // Follower delta in the bucket.
    const endCount = followersAsOf(b.endIso);
    const beforeStart = new Date(`${b.startIso}T00:00:00Z`);
    beforeStart.setUTCDate(beforeStart.getUTCDate() - 1);
    const startCount = followersAsOf(beforeStart.toISOString().slice(0, 10));
    const bucketGain =
      endCount != null && startCount != null ? endCount - startCount : 0;

    // Per-period
    const bucketFollowersPerPost =
      bucketPosts > 0 ? bucketGain / bucketPosts : 0;
    const bucketImprPerPost =
      bucketPosts > 0 ? bucketImpr / bucketPosts : 0;

    followerPerPeriod.push({
      label: b.label,
      value: bucketGain,
      followersPerPost: Number(bucketFollowersPerPost.toFixed(2)),
    });
    impressionsPerPeriod.push({
      label: b.label,
      value: bucketImpr,
      impressionsPerPost: Math.round(bucketImprPerPost),
    });

    const bucketRate = bucketImpr > 0 ? (bucketEng / bucketImpr) * 100 : 0;
    engagementPerPeriod.push({
      label: b.label,
      engagements: bucketEng,
      rate: Number(bucketRate.toFixed(2)),
    });

    // Cumulative — "rate" variants are running averages: Σfollower gain ÷
    // Σposts so far, not the sum of bucket ratios (which double-weights
    // low-volume buckets).
    runningImpr += bucketImpr;
    runningEng += bucketEng;
    runningPosts += bucketPosts;
    runningFollowerGain += bucketGain;

    const cumFollowersPerPost =
      runningPosts > 0 ? runningFollowerGain / runningPosts : 0;
    const cumImprPerPost =
      runningPosts > 0 ? runningImpr / runningPosts : 0;

    followerCumulative.push({
      label: b.label,
      value: endCount ?? 0,
      followersPerPost: Number(cumFollowersPerPost.toFixed(2)),
    });
    impressionsCumulative.push({
      label: b.label,
      value: runningImpr,
      impressionsPerPost: Math.round(cumImprPerPost),
    });

    const cumRate = runningImpr > 0 ? (runningEng / runningImpr) * 100 : 0;
    engagementCumulative.push({
      label: b.label,
      engagements: runningEng,
      rate: Number(cumRate.toFixed(2)),
    });
  }

  // --- Growth-math cascade + correlation callout --------------------------
  //
  // The cascade expresses the equation `posts × impr/post × ER =
  // engagements → followers` for the selected window — makes the
  // dashboard's causal model explicit. The correlation value comes
  // from the full captured pool (not the window), so it stays stable
  // as Pedro changes range and serves as "what drives my growth
  // according to MY data."
  const cascadeAvgImprPerPost =
    posts.length > 0 && totalImpressions > 0
      ? Math.round(totalImpressions / posts.length)
      : 0;
  const cascadeAvgErPct =
    totalImpressions > 0
      ? ((totalEngagements / totalImpressions) * 100).toFixed(2)
      : '0.00';

  // Correlation uses all snapshot-bearing posts regardless of the
  // selected window — more data = more stable. Pre-phase-3d posts
  // with impressions=0 are filtered (they'd be noise).
  const corrPool = postsAll.filter((p) => p.impressions > 0);
  const corrEngToFollowers = pearson(
    corrPool.map((p) => p.social_engagements),
    corrPool.map((p) => p.followers_gained),
  );

  // Progress Report — period-over-period comparison across all 4 modes
  // (MTD, last 30d, last full month, last quarter). Computed against the
  // FULL history (postsAll, dailyEngagementAll, followerHistory), not the
  // currently-selected RangeFilter window — the report defines its own
  // windows. The toggle on the client switches between pre-computed modes
  // without an extra round-trip.
  const progressReport = buildAllModes(
    postsAll,
    dailyEngagementAll,
    followerHistory,
  );

  return (
    <div className="space-y-6">
      {/* Stale-xlsx warning banner. Server-rendered above everything;
          returns null and renders nothing when xlsx is fresh (≤45d). */}
      <StaleDataBanner />

      {/* Page Title + range filter + data-freshness indicator */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Executive Summary
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {range.label} performance overview · {formatNumber(posts.length)}{' '}
            {posts.length === 1 ? 'post' : 'posts'} in window
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangeFilter />
          <IngestHealthBadge health={ingestHealth} />
        </div>
      </div>

      {/* Growth-math cascade — surfaces the causal chain the dashboard
          optimizes for: post volume × reach × resonance → engagements
          → followers. Driver line (second row) names the empirically
          strongest predictor of follower growth in your data. */}
      {posts.length > 0 && (
        <div
          className="card"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div
            className="text-xs uppercase tracking-wide mb-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Growth math — this window
          </div>
          <div
            className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="font-semibold tabular-nums">
              {formatNumber(posts.length)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>posts</span>
            <span style={{ color: 'var(--text-muted)' }}>×</span>
            <span className="font-semibold tabular-nums">
              {formatNumber(cascadeAvgImprPerPost)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>avg impr/post</span>
            <span style={{ color: 'var(--text-muted)' }}>×</span>
            <span className="font-semibold tabular-nums">{cascadeAvgErPct}%</span>
            <span style={{ color: 'var(--text-muted)' }}>ER</span>
            <span className="mx-1" style={{ color: 'var(--accent)' }}>
              →
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: 'var(--accent)' }}
            >
              {formatNumber(totalEngagements)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>engagements</span>
            {followerGrowth != null && (
              <>
                <span className="mx-1" style={{ color: 'var(--success)' }}>
                  →
                </span>
                <span
                  className="font-semibold tabular-nums"
                  style={{
                    color:
                      followerGrowth >= 0 ? 'var(--success)' : '#dc2626',
                  }}
                >
                  {followerGrowth >= 0 ? '+' : ''}
                  {formatNumber(followerGrowth)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  new followers
                </span>
              </>
            )}
          </div>
          {corrEngToFollowers != null && corrPool.length >= 10 && (
            <div
              className="text-xs mt-3 leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                Driver in your data:
              </span>{' '}
              total engagements best predicts follower growth · r=
              {corrEngToFollowers.toFixed(2)} · n={corrPool.length} captured
              posts. Engagement rate alone shows near-zero correlation — it's
              the absolute count that moves the needle.
            </div>
          )}
        </div>
      )}

      {/* Row 1: Key Metrics.
          Order mirrors the cascade: outcome (followers) → proximate
          driver (engagements) → reach (impressions) → quality (ER). */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Followers"
          value={formatNumber(profile.total_followers)}
          change={
            followerGrowth != null
              ? `${followerGrowth >= 0 ? '+' : ''}${formatNumber(followerGrowth)}${
                  followerGrowthPercent != null ? ` (${followerGrowth >= 0 ? '+' : ''}${followerGrowthPercent}%)` : ''
                } over ${range.label.toLowerCase()}`
              : undefined
          }
          changeType={
            followerGrowth == null || followerGrowth === 0
              ? 'neutral'
              : followerGrowth > 0
                ? 'positive'
                : 'negative'
          }
        />
        <MetricCard
          label="Total Engagements"
          value={formatNumber(totalEngagements)}
          subtitle={
            metrics.totalEngagements > 0
              ? `Avg: ${formatNumber(metrics.avgEngagements)}/captured post`
              : 'from daily rollups'
          }
        />
        <MetricCard
          label="Total Impressions"
          value={formatNumber(totalImpressions)}
          subtitle={
            metrics.totalImpressions > 0
              ? `Avg: ${formatNumber(metrics.avgImpressions)}/captured post`
              : 'from daily rollups'
          }
        />
        <MetricCard
          label="Avg Engagement Rate"
          value={`${avgEngagementRate}%`}
          subtitle="Engagements / Impressions"
        />
      </div>

      {/* Row 1.5: Progress Report — cross-period KPI comparison.
          Independent of the RangeFilter above; defines its own windows
          (MTD / last 30d / last full month / last quarter) with toggle. */}
      <ProgressReport data={progressReport} />

      {/* Row 2: Range-aware charts (Followers / Impressions / Engagement) */}
      <RangeCharts
        bucketSize={bucketSize}
        followers={{
          perPeriod: followerPerPeriod,
          cumulative: followerCumulative,
        }}
        impressions={{
          perPeriod: impressionsPerPeriod,
          cumulative: impressionsCumulative,
        }}
        engagement={{
          perPeriod: engagementPerPeriod,
          cumulative: engagementCumulative,
        }}
      />

      {/* Row 3: Monthly Breakdown Table */}
      <div className="card">
        <h3 className="section-title">Monthly Breakdown</h3>
        {monthlyData.length === 0 ? (
          <div
            className="text-sm italic py-4"
            style={{ color: 'var(--text-muted)' }}
          >
            No daily engagement in this range.
          </div>
        ) : (
        <>
        {/* Desktop table — same dense layout as before. */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left py-2 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Month
                </th>
                <th className="text-right py-2 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Posts
                </th>
                <th className="text-right py-2 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Engagement Rate
                </th>
                <th className="text-right py-2 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  New Followers / Post
                </th>
                <th className="text-right py-2 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Impressions / Post
                </th>
              </tr>
            </thead>
            <tbody>
              {[...monthlyData].reverse().map((row) => {
                const isBestMonth = highlightBest && bestMonth != null && row.month === bestMonth.month;
                const postCount = postsPerMonth.get(row.month) ?? 0;
                const newFollowers = newFollowersInMonth(row.month);
                const engagementRate =
                  row.impressions > 0
                    ? `${((row.engagements / row.impressions) * 100).toFixed(2)}%`
                    : '—';
                const newFollowersPerPost =
                  postCount > 0 && newFollowers != null
                    ? formatNumber(Math.round(newFollowers / postCount))
                    : '—';
                const impressionsPerPost =
                  postCount > 0 ? formatNumber(Math.round(row.impressions / postCount)) : '—';
                const partial = monthCoverageMap.get(row.month) ?? null;
                const partialTitle = partial
                  ? `Aggregate data covers ${partial.actual} of ${partial.expected} elapsed days this month.`
                  : undefined;
                return (
                  <tr
                    key={row.month}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      backgroundColor: isBestMonth ? 'var(--accent-light)' : 'transparent',
                    }}
                  >
                    <td className="py-2 px-3" style={{ color: 'var(--text-primary)' }}>
                      {new Date(row.month + '-01T00:00:00Z').toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                      {isBestMonth && (
                        <span className="ml-2 text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
                          Best
                        </span>
                      )}
                    </td>
                    <td className="text-right py-2 px-3" style={{ color: 'var(--text-primary)' }}>
                      {postCount > 0 ? formatNumber(postCount) : '—'}
                    </td>
                    <td className="text-right py-2 px-3" style={{ color: 'var(--text-primary)' }}>
                      {engagementRate}
                      {partial && (
                        <sup
                          title={partialTitle}
                          style={{ color: '#d97706', marginLeft: '2px' }}
                        >
                          *
                        </sup>
                      )}
                    </td>
                    <td className="text-right py-2 px-3" style={{ color: 'var(--text-primary)' }}>
                      {newFollowersPerPost}
                    </td>
                    <td className="text-right py-2 px-3" style={{ color: 'var(--text-primary)' }}>
                      {impressionsPerPost}
                      {partial && (
                        <sup
                          title={partialTitle}
                          style={{ color: '#d97706', marginLeft: '2px' }}
                        >
                          *
                        </sup>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: same data, one card per month. 5-col table doesn't fit
            a 375px viewport — each metric becomes a labeled row inside a
            card. "Best month" still highlights via accent border. */}
        <div className="md:hidden space-y-3">
          {[...monthlyData].reverse().map((row) => {
            const isBestMonth = highlightBest && bestMonth != null && row.month === bestMonth.month;
            const postCount = postsPerMonth.get(row.month) ?? 0;
            const newFollowers = newFollowersInMonth(row.month);
            const engagementRate =
              row.impressions > 0
                ? `${((row.engagements / row.impressions) * 100).toFixed(2)}%`
                : '—';
            const newFollowersPerPost =
              postCount > 0 && newFollowers != null
                ? formatNumber(Math.round(newFollowers / postCount))
                : '—';
            const impressionsPerPost =
              postCount > 0 ? formatNumber(Math.round(row.impressions / postCount)) : '—';
            const partial = monthCoverageMap.get(row.month) ?? null;
            const monthLabel = new Date(row.month + '-01T00:00:00Z').toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            });
            return (
              <div
                key={row.month}
                className="rounded-lg border p-3"
                style={{
                  borderColor: isBestMonth ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: 'var(--bg-secondary)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {monthLabel}
                  </div>
                  {isBestMonth && (
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--accent)', color: 'white' }}
                    >
                      Best
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Posts</div>
                    <div className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {postCount > 0 ? formatNumber(postCount) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Engagement Rate</div>
                    <div className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {engagementRate}
                      {partial && (
                        <sup style={{ color: '#d97706', marginLeft: '2px' }}>*</sup>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>New Followers / Post</div>
                    <div className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {newFollowersPerPost}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Impressions / Post</div>
                    <div className="tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {impressionsPerPost}
                      {partial && (
                        <sup style={{ color: '#d97706', marginLeft: '2px' }}>*</sup>
                      )}
                    </div>
                  </div>
                </div>
                {partial && (
                  <div
                    className="text-xs mt-2"
                    style={{ color: '#92400e' }}
                  >
                    * Aggregate data covers {partial.actual} of {partial.expected} elapsed days.
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {anyMonthIsPartial && (
          <div
            className="text-xs mt-3 px-1"
            style={{ color: '#92400e' }}
          >
            <span style={{ color: '#d97706' }}>*</span> Engagement Rate and
            Impressions / Post derive from the LinkedIn Aggregate Analytics
            XLSX, which is imported in user-selected windows. Months marked
            with * have gaps —{' '}
            {dailyEngagementLastDate
              ? `aggregate data ends ${dailyEngagementLastDate}. `
              : ''}
            Upload a wider window in <a href="/data-health" style={{ textDecoration: 'underline' }}>/data-health</a> to fill the gaps.
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

/**
 * Small status pill showing when post_snapshots last grew — i.e. when
 * the feed interceptor (voyagerFeedDashProfileUpdates) last fired.
 * Sourced from post_snapshots.captured_at (NOT ingest_log) because the
 * daily follower-scrape POSTs an empty posts[] every day and would
 * otherwise hide a dead feed interceptor behind a green pill.
 * Color rules:
 *   < 48h  = green  (fresh; recent browser session captured posts)
 *   < 72h  = yellow (starting to lag — open LinkedIn feed/profile soon)
 *   >= 72h = red    (likely broken; open LinkedIn or check extension)
 *   null   = gray   (no post snapshot ever recorded)
 */
function IngestHealthBadge({ health }: { health: IngestHealth }) {
  const h = health.lastSuccessHoursAgo;
  let tone: 'fresh' | 'lagging' | 'stale' | 'unknown' = 'unknown';
  if (h == null) tone = 'unknown';
  else if (h < 48) tone = 'fresh';
  else if (h < 72) tone = 'lagging';
  else tone = 'stale';

  const dotColor = {
    fresh: 'var(--success)',
    lagging: 'var(--warning)',
    stale: '#dc2626',
    unknown: 'var(--text-muted)',
  }[tone];

  const label =
    h == null
      ? 'never'
      : h < 1
        ? 'just now'
        : h < 24
          ? `${Math.round(h)}h ago`
          : `${Math.round(h / 24)}d ago`;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-secondary)',
      }}
      title={
        health.lastSuccessAt
          ? `Last post snapshot captured at ${health.lastSuccessAt} (last ingest source: ${health.lastSource ?? 'unknown'})`
          : 'No post snapshot recorded yet'
      }
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      <span>Last capture: {label}</span>
    </div>
  );
}
