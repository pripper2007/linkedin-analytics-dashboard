import React from 'react';
import {
  getUserComments,
  getUserReactions,
} from '@/lib/data-csv';
import { getAllPosts } from '@/lib/queries';
import { extractTopMentions } from '@/lib/activity/extract-names';
import { buildCadence } from '@/lib/activity/cadence';
import { resolveRange } from '@/lib/date-range';
import { RangeFilter } from '../RangeFilter';
import { MetricCard } from '@/components/cards/MetricCard';
import EngagementCadenceHeatmap from '@/components/charts/EngagementCadenceHeatmap';
import HorizontalCountBar from '@/components/charts/HorizontalCountBar';
import PostingVsEngagingChart from '@/components/charts/PostingVsEngagingChart';

// Activity = Pedro's CONSUMING side: reactions and comments he gave to
// other people's content. The dashboard, optimization, and growth pages
// cover the producing side. Earlier version of this page tried to
// summarize raw counts with a tall multi-series bar chart that wasn't
// telling Pedro anything actionable; the redesign focuses on:
//
//   1. Habit cadence — when you engage (day × time-of-day heatmap).
//   2. Who you engage with — top names extracted from comment bodies
//      (proxy: LinkedIn export doesn't ship author info per reaction,
//      but comment greetings carry the addressee).
//   3. How you react — reaction-type breakdown as a horizontal bar
//      consistent with /audience.
//   4. Posting vs engaging — does your engagement track your output?
//      (clean Recharts grouped bar instead of the prior hand-rolled bars.)
export const metadata = {
  title: 'Engagement Habits',
  description: "How you engage on LinkedIn — who, when, and how",
};
export const dynamic = 'force-dynamic';

interface MentionRow {
  name: string;
  count: number;
}

const REACTION_LABELS: Record<string, string> = {
  LIKE: 'Like',
  PRAISE: 'Celebrate',
  EMPATHY: 'Love',
  ENTERTAINMENT: 'Funny',
  INTEREST: 'Curious',
  APPRECIATION: 'Insightful',
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: { range?: string; from?: string; to?: string };
}) {
  const range = resolveRange(searchParams ?? {});
  const fromIso = range.fromIso;
  const toIso = range.toIso;

  const [allComments, allReactions, posts] = await Promise.all([
    getUserComments(),
    getUserReactions(),
    getAllPosts(),
  ]);

  // Filter to range. Reactions/comments use "YYYY-MM-DD HH:MM:SS" so
  // an ISO date prefix comparison works without parsing every row.
  const comments = allComments.filter(
    (c) => c.date.slice(0, 10) >= fromIso && c.date.slice(0, 10) <= toIso,
  );
  const reactions = allReactions.filter(
    (r) => r.date.slice(0, 10) >= fromIso && r.date.slice(0, 10) <= toIso,
  );
  const postsInRange = posts.filter((p) => {
    const d = new Date(p.post_date);
    if (isNaN(d.getTime())) return false;
    return d >= range.from && d <= range.to;
  });

  // KPIs
  const avgCommentLength =
    comments.length > 0
      ? Math.round(
          comments.reduce((s, c) => s + (c.message?.length ?? 0), 0) /
            comments.length,
        )
      : 0;
  const totalEvents = reactions.length + comments.length;
  const engagementsPerPost =
    postsInRange.length > 0
      ? Math.round(totalEvents / postsInRange.length)
      : 0;

  // Top mentions — proxy for "who you engage with most".
  const mentions: MentionRow[] = extractTopMentions(
    comments.map((c) => c.message ?? ''),
    15,
  );

  // Reaction type distribution as a horizontal bar (replaces prior pie).
  const reactionCounts = new Map<string, number>();
  for (const r of reactions) {
    if (!r.type) continue;
    reactionCounts.set(r.type, (reactionCounts.get(r.type) ?? 0) + 1);
  }
  const reactionData = [...reactionCounts.entries()]
    .map(([type, count]) => ({
      name: REACTION_LABELS[type] ?? type,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Cadence heatmap — day × time-of-day across reactions+comments.
  const allTimestamps = [
    ...reactions.map((r) => r.date),
    ...comments.map((c) => c.date),
  ];
  const cadence = buildCadence(allTimestamps);

  // Posting vs engaging — last 12 months even if range is shorter,
  // because the question "did your engagement follow your posting?"
  // benefits from a longer view than a 30-day window. Bucket by month.
  const monthly = new Map<
    string,
    { posts: number; engagements: number }
  >();
  const ensureMonth = (m: string) => {
    if (!monthly.has(m)) monthly.set(m, { posts: 0, engagements: 0 });
    return monthly.get(m)!;
  };
  for (const c of allComments) ensureMonth(c.date.slice(0, 7)).engagements += 1;
  for (const r of allReactions) ensureMonth(r.date.slice(0, 7)).engagements += 1;
  for (const p of posts) {
    if (!p.post_date) continue;
    const d = new Date(p.post_date);
    if (isNaN(d.getTime())) continue;
    const m = d.toISOString().slice(0, 7);
    ensureMonth(m).posts += 1;
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 11);
  const cutoffMonth = cutoff.toISOString().slice(0, 7);
  const correlation = [...monthly.entries()]
    .filter(([m]) => m >= cutoffMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => ({
      month: new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      posts: v.posts,
      engagements: v.engagements,
    }));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            Engagement Habits
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            How you engage on others&apos; LinkedIn content — who, when,
            and how. {range.label.toLowerCase()}, {totalEvents.toLocaleString()}{' '}
            reactions+comments.
          </p>
        </div>
        <RangeFilter basePath="/activity" />
      </div>

      {/* KPIs — 3 cards, dropping prior "Most Active Month" which wasn't
          actionable. Engagements/post ratio replaces it: a sharper
          signal for "are you investing as much in others as in yourself". */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Reactions Given"
          value={reactions.length.toLocaleString()}
          subtitle={range.label.toLowerCase()}
        />
        <MetricCard
          label="Comments Made"
          value={comments.length.toLocaleString()}
          subtitle={range.label.toLowerCase()}
        />
        <MetricCard
          label="Engagements / Post"
          value={engagementsPerPost.toLocaleString()}
          subtitle="Reactions+comments per post you published"
        />
        <MetricCard
          label="Avg Comment Length"
          value={`${avgCommentLength} ch`}
          subtitle={
            avgCommentLength < 60
              ? 'Short — quick replies'
              : avgCommentLength < 200
                ? 'Medium'
                : 'Long-form replies'
          }
        />
      </div>

      {/* People + Reaction types — the "who and how" pair */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="section-title">People you engage with</h3>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            Most-mentioned names in your comments — proxy for the people
            you address by name when reacting to their posts. (LinkedIn
            export doesn&apos;t ship author info per reaction, so this
            counts comment greetings only.)
          </p>
          {mentions.length === 0 ? (
            <div
              className="text-sm italic py-4"
              style={{ color: 'var(--text-muted)' }}
            >
              No comment-based mentions in this window.
            </div>
          ) : (
            <HorizontalCountBar data={mentions} unitLabel="comment" />
          )}
        </div>

        <div className="card">
          <h3 className="section-title">How you react</h3>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            Distribution across LinkedIn&apos;s reaction types.
          </p>
          {reactionData.length === 0 ? (
            <div
              className="text-sm italic py-4"
              style={{ color: 'var(--text-muted)' }}
            >
              No reactions in this window.
            </div>
          ) : (
            <HorizontalCountBar
              data={reactionData}
              unitLabel="reaction"
              rowHeight={36}
              yAxisWidth={120}
            />
          )}
        </div>
      </div>

      {/* Cadence heatmap */}
      <EngagementCadenceHeatmap cells={cadence} />

      {/* Posting vs engaging — fixed 12-month context regardless of
          range filter, because the correlation question only makes
          sense over a multi-month view. */}
      <div className="card">
        <h3 className="section-title">Posting vs. engaging (last 12 months)</h3>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          Months where you posted more — did you also engage more on
          others&apos; content? Independent of the range filter above.
        </p>
        {correlation.length === 0 ? (
          <div
            className="text-sm italic py-4"
            style={{ color: 'var(--text-muted)' }}
          >
            No data in the last 12 months.
          </div>
        ) : (
          <PostingVsEngagingChart data={correlation} />
        )}
      </div>

      {/* Recent comments — kept (it's a nice scroll-back reference) but
          condensed. */}
      {comments.length > 0 && (
        <div className="card">
          <h3 className="section-title">Recent comments</h3>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            Last 10 comments you made on others&apos; posts in this window.
          </p>
          <div className="space-y-3">
            {comments.slice(0, 10).map((comment, idx) => (
              <div
                key={idx}
                className="flex gap-4 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div
                  className="text-xs whitespace-nowrap pt-0.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {new Date(comment.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm truncate"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {comment.message || '(no text)'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
