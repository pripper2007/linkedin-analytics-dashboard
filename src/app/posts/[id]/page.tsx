import React from 'react';
import { notFound } from 'next/navigation';
import {
  getAllPosts,
  getPostById,
  getPostMedia,
  getCachedAnalysis,
  type PostMediaItem,
} from '@/lib/queries';
import {
  calculatePostMetrics,
  formatNumber,
  formatDate,
} from '@/lib/calculations';
import type { Post } from '@/lib/types';
import { EngagementFunnel } from '@/components/charts/EngagementFunnel';
import { DemographicChart } from '@/components/charts/DemographicChart';
import { loadSkillFile } from '@/lib/analyze-post/skill-file';
import { AnalysisPanel } from './AnalysisPanel';

export const dynamic = 'force-dynamic';

interface PostPageProps {
  params: { id: string };
}

export default async function PostPage({ params }: PostPageProps) {
  const [post, allPosts, media, cachedAnalysis, skill] = await Promise.all([
    getPostById(params.id),
    getAllPosts(),
    getPostMedia(params.id),
    getCachedAnalysis(params.id),
    loadSkillFile(),
  ]);
  if (!post) notFound();

  const captured = allPosts.filter((p) => p.impressions > 0);
  const metrics = calculatePostMetrics(captured);

  // --- Comparison vs the captured pool --------------------------------------
  const impressionDiff = post.impressions - metrics.avgImpressions;
  const impressionPct =
    metrics.avgImpressions > 0
      ? ((impressionDiff / metrics.avgImpressions) * 100).toFixed(1)
      : '0.0';
  const engagementDiff = post.engagement_rate - metrics.avgEngagementRate;
  const engagementPct =
    metrics.avgEngagementRate > 0
      ? ((engagementDiff / metrics.avgEngagementRate) * 100).toFixed(1)
      : '0.0';
  const followersDiff = post.followers_gained - metrics.avgFollowersGained;
  const followersPct =
    metrics.avgFollowersGained > 0
      ? ((followersDiff / metrics.avgFollowersGained) * 100).toFixed(1)
      : '0.0';

  // --- Cohort + percentile analysis (Phase 2 light) -------------------------
  const insights = buildPerformanceInsights(post, captured);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Post Deep-Dive
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {formatDate(post.post_date)} · {post.topic} · {post.style}
        </p>
      </div>

      {/* Post content + media */}
      <div className="card">
        <h3 className="section-title">Post</h3>
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            whiteSpace: 'pre-wrap',
          }}
        >
          <p
            style={{
              color: 'var(--text-primary)',
              lineHeight: '1.6',
              margin: 0,
            }}
          >
            {post.post_content}
          </p>
        </div>

        {media.length > 0 && (
          <div className="mt-4">
            <PostMediaGrid media={media} />
            <p
              className="text-xs mt-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {media.some((m) => m.blobUrl)
                ? 'Media mirrored to local storage — durable.'
                : 'Media served from LinkedIn CDN — may break for older posts.'}
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={post.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm px-3 py-1 rounded font-medium"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            View on LinkedIn ↗
          </a>
        </div>
      </div>

      {/* Phase 9.A — Claude qualitative critique. Server passes the
          latest cached analysis (or null) + the current skill-file
          hash; the client island handles streaming + Re-analyze. */}
      <AnalysisPanel
        activityId={post.activity_id}
        cachedAnalysis={cachedAnalysis}
        currentSkillHash={skill.hash}
      />

      {/* Why this performed — interpretive Phase 2 light */}
      {insights.length > 0 && (
        <div className="card">
          <h3 className="section-title">Why this post performed this way</h3>
          <div className="space-y-3">
            {insights.map((ins, idx) => (
              <InsightCard key={idx} insight={ins} />
            ))}
          </div>
          <p
            className="text-xs mt-4"
            style={{ color: 'var(--text-muted)' }}
          >
            Comparisons use the {captured.length} posts with captured analytics.
            Cohorts are subsets matched by topic + content features.
          </p>
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Impressions"
          value={formatNumber(post.impressions)}
          deltaPct={impressionPct}
          deltaPositive={impressionDiff > 0}
          subtitle={`Avg: ${formatNumber(metrics.avgImpressions)}`}
        />
        <MetricCard
          label="Engagement Rate"
          value={`${post.engagement_rate.toFixed(2)}%`}
          deltaPct={engagementPct}
          deltaPositive={engagementDiff > 0}
          subtitle={`Avg: ${metrics.avgEngagementRate.toFixed(2)}%`}
        />
        <MetricCard
          label="Followers Gained"
          value={formatNumber(post.followers_gained)}
          deltaPct={followersPct}
          deltaPositive={followersDiff > 0}
          subtitle={`Avg: ${formatNumber(metrics.avgFollowersGained)}`}
        />
      </div>

      <EngagementFunnel post={post} />

      {/* Engagement breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="metric-label">Reactions</div>
          <div className="metric-value">{formatNumber(post.reactions)}</div>
          <div
            className="text-xs mt-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Avg: {formatNumber(metrics.avgReactions)}
          </div>
        </div>
        <div className="card">
          <div className="metric-label">Comments</div>
          <div className="metric-value">{formatNumber(post.comments)}</div>
          <div
            className="text-xs mt-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Avg: {formatNumber(metrics.avgComments)}
          </div>
        </div>
        <div className="card">
          <div className="metric-label">Reposts</div>
          <div className="metric-value">{formatNumber(post.reposts)}</div>
        </div>
        <div className="card">
          <div className="metric-label">Saves</div>
          <div className="metric-value">{formatNumber(post.saves)}</div>
        </div>
      </div>

      {/* Post attributes */}
      <div className="card">
        <h3 className="section-title">Post Attributes</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Image', value: post.has_image },
            { label: 'Link', value: post.has_link },
            { label: 'Emoji', value: post.has_emoji },
            { label: 'Bold Unicode', value: post.has_bold_unicode },
            { label: 'Bullet Points', value: post.has_bullet_points },
            { label: 'Question', value: post.has_question },
          ].map((attr) => (
            <div
              key={attr.label}
              className="p-3 rounded-lg text-center"
              style={{
                backgroundColor: attr.value
                  ? 'var(--accent-light)'
                  : 'var(--bg-secondary)',
              }}
            >
              <div
                className="text-sm font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {attr.label}
              </div>
              <div
                style={{
                  color: attr.value ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '1.25rem',
                  fontWeight: 'bold',
                }}
              >
                {attr.value ? '✓' : '✗'}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="metric-label">Word Count</div>
            <div className="metric-value mt-1">{post.word_count}</div>
          </div>
          <div>
            <div className="metric-label">Paragraphs</div>
            <div className="metric-value mt-1">{post.paragraph_count}</div>
          </div>
          <div>
            <div className="metric-label">Features</div>
            <div className="metric-value mt-1">{post.feature_count}</div>
          </div>
        </div>
      </div>

      {/* Demographics */}
      {post.demographics && (
        <div>
          <h2
            className="text-2xl font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Audience Demographics
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DemographicChart
              title="Top Job Titles"
              data={post.demographics.job_title}
            />
            <DemographicChart
              title="Top Locations"
              data={post.demographics.location}
            />
            <DemographicChart
              title="Seniority Levels"
              data={post.demographics.seniority}
            />
            <DemographicChart
              title="Top Companies"
              data={post.demographics.company}
            />
            <DemographicChart
              title="Top Industries"
              data={post.demographics.industry}
            />
            <DemographicChart
              title="Company Sizes"
              data={post.demographics.company_size}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insight builder — Phase 2 (heuristic). Compares the post against
// percentile thresholds + cohort medians (matched by topic + features).
// ---------------------------------------------------------------------------
type InsightTone = 'positive' | 'negative' | 'neutral';
interface Insight {
  title: string;
  body: string;
  tone: InsightTone;
}

function buildPerformanceInsights(post: Post, pool: Post[]): Insight[] {
  if (pool.length < 5) return [];
  const out: Insight[] = [];

  // Percentile of follower gains (the north-star metric).
  const folSorted = [...pool]
    .map((p) => p.followers_gained)
    .sort((a, b) => a - b);
  const folPercentile = percentileRank(folSorted, post.followers_gained);
  if (folPercentile >= 90) {
    out.push({
      tone: 'positive',
      title: `Top ${(100 - folPercentile).toFixed(0)}% by follower growth`,
      body: `Gained ${formatNumber(post.followers_gained)} new followers — among the strongest in your captured pool. Worth studying what made this one different.`,
    });
  } else if (folPercentile <= 25) {
    out.push({
      tone: 'negative',
      title: `Bottom 25% by follower growth`,
      body: `Only ${formatNumber(post.followers_gained)} new followers gained. Compare against your top performers to spot what's missing — likely a combination of reach and resonance issues.`,
    });
  }

  // Engagement-rate percentile.
  const erSorted = [...pool]
    .map((p) => p.engagement_rate)
    .sort((a, b) => a - b);
  const erPercentile = percentileRank(erSorted, post.engagement_rate);
  if (erPercentile >= 90) {
    out.push({
      tone: 'positive',
      title: `Top ${(100 - erPercentile).toFixed(0)}% by engagement rate`,
      body: `${post.engagement_rate.toFixed(2)}% ER — content resonated strongly with the audience that saw it. This is what unlocks LinkedIn's algorithmic boost.`,
    });
  } else if (erPercentile <= 25 && post.impressions > 0) {
    out.push({
      tone: 'negative',
      title: `Bottom 25% by engagement rate`,
      body: `${post.engagement_rate.toFixed(2)}% ER — well below your typical resonance. Reach without engagement signals to the algorithm "fewer follows, less amplification."`,
    });
  }

  // Cohort match: posts with same topic + same image/question/bullet
  // points status. If we have ≥3 cohort matches, compare median.
  const cohort = pool.filter(
    (p) =>
      p.topic === post.topic &&
      p.has_image === post.has_image &&
      p.has_question === post.has_question &&
      p.has_bullet_points === post.has_bullet_points,
  );
  if (cohort.length >= 3) {
    const cohortMedianImpr = median(cohort.map((p) => p.impressions));
    const ratio =
      cohortMedianImpr > 0 ? post.impressions / cohortMedianImpr : 0;
    const cohortDescription = describeCohort(post);
    if (ratio >= 1.5) {
      out.push({
        tone: 'positive',
        title: `Beat its cohort median by ${((ratio - 1) * 100).toFixed(0)}%`,
        body: `Among your ${cohort.length} posts that share this profile (${cohortDescription}), this one reached ${formatNumber(post.impressions)} vs cohort median ${formatNumber(Math.round(cohortMedianImpr))}.`,
      });
    } else if (ratio > 0 && ratio <= 0.7) {
      out.push({
        tone: 'negative',
        title: `Underperformed its cohort by ${((1 - ratio) * 100).toFixed(0)}%`,
        body: `Your other ${cohort.length} ${cohortDescription} posts averaged ${formatNumber(Math.round(cohortMedianImpr))} impressions; this one got ${formatNumber(post.impressions)}. Consider timing or hook.`,
      });
    }
  }

  // Feature signals — quick wins or red flags.
  if (post.has_link) {
    out.push({
      tone: 'negative',
      title: 'Has external link',
      body: 'LinkedIn deprioritizes posts with off-platform links — typically a 30-50% impressions hit. If you must share a link, putting it in the first comment usually helps.',
    });
  }
  if (post.has_image && post.has_question && post.has_bullet_points) {
    out.push({
      tone: 'positive',
      title: 'Triple-stack of positive content signals',
      body: 'Image + question prompt + scannable bullets — historically your strongest content format combination.',
    });
  } else if (
    !post.has_image &&
    !post.has_emoji &&
    !post.has_bold_unicode
  ) {
    out.push({
      tone: 'negative',
      title: 'No visual or formatting hooks',
      body: 'No image, no emoji, no bold-unicode highlights. Plain text drops scroll-stopping power on LinkedIn — the algorithm tends to amplify visually distinct posts.',
    });
  }

  return out;
}

function percentileRank(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  let count = 0;
  for (const v of sorted) {
    if (v < value) count++;
  }
  return (count / sorted.length) * 100;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function describeCohort(post: Post): string {
  const bits: string[] = [post.topic];
  if (post.has_image) bits.push('with image');
  if (post.has_question) bits.push('with question');
  if (post.has_bullet_points) bits.push('with bullets');
  return bits.join(', ');
}

// ---------------------------------------------------------------------------
// Small components used above
// ---------------------------------------------------------------------------
function PostMediaGrid({ media }: { media: PostMediaItem[] }) {
  // Filter to renderable items: images + video thumbnails. We don't
  // try to play videos inline (LinkedIn's CDN typically blocks
  // hotlinked playback); thumbnails preserve the visual.
  const renderable = media.filter(
    (m) => m.kind === 'image' || m.kind === 'video_thumbnail',
  );
  if (renderable.length === 0) return null;
  // Single image: cap to a reasonable preview size and center.
  // Carousel (multi): 2-col grid with smaller per-tile cap.
  const isSingle = renderable.length === 1;
  return (
    <div
      className={
        isSingle
          ? 'flex justify-center'
          : 'grid grid-cols-2 md:grid-cols-3 gap-3'
      }
    >
      {renderable.map((m, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={m.bestUrl}
          alt=""
          className="rounded-lg"
          style={{
            // Show the whole image, never crop.
            objectFit: 'contain',
            // Single: medium preview that doesn't dominate the page.
            // Multi: tile-sized; relies on grid columns for width.
            maxWidth: isSingle ? '420px' : '100%',
            maxHeight: isSingle ? '320px' : '180px',
            width: isSingle ? 'auto' : '100%',
            border: '1px solid var(--border)',
          }}
        />
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  deltaPct,
  deltaPositive,
  subtitle,
}: {
  label: string;
  value: string;
  deltaPct: string;
  deltaPositive: boolean;
  subtitle: string;
}) {
  return (
    <div className="card">
      <div className="metric-label">{label}</div>
      <div className="metric-value my-2">{value}</div>
      <div
        style={{
          color: deltaPositive ? 'var(--success)' : 'var(--warning)',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        {deltaPositive ? '+' : ''}
        {deltaPct}% vs avg
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        {subtitle}
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const accent =
    insight.tone === 'positive'
      ? 'var(--success)'
      : insight.tone === 'negative'
        ? '#dc2626'
        : 'var(--text-muted)';
  const bg =
    insight.tone === 'positive'
      ? 'rgba(5, 118, 66, 0.08)'
      : insight.tone === 'negative'
        ? 'rgba(220, 38, 38, 0.06)'
        : 'var(--bg-secondary)';
  return (
    <div
      className="p-3 rounded-lg"
      style={{ backgroundColor: bg, borderLeft: `3px solid ${accent}` }}
    >
      <div
        className="text-sm font-semibold mb-1"
        style={{ color: accent }}
      >
        {insight.title}
      </div>
      <div
        className="text-sm leading-relaxed"
        style={{ color: 'var(--text-primary)' }}
      >
        {insight.body}
      </div>
    </div>
  );
}
