'use client';

// Head-to-head post comparison, rendered as a tornado / diverging-bar
// layout. Each metric row is centered; Post A's bar extends left,
// Post B's bar extends right. Bars are scaled so the winner fills its
// half. Winner colored green, loser red — quick visual read per metric.

import Link from 'next/link';
import React, { useMemo, useState } from 'react';
import {
  formatNumber,
  formatDate,
  parsePct,
  truncateChars,
} from '@/lib/calculations';
import type { Post, Demographics } from '@/lib/types';

interface CompareClientProps {
  posts: Post[];
}

// -- Metric registry --------------------------------------------------------
//
// Each row rendered by the diverging-bar layout is defined here. Grouped
// into "sections" that render as labeled blocks on the page.
type MetricFormatter = (n: number) => string;
interface MetricDef {
  key: string;
  label: string;
  get: (p: Post) => number;
  format?: MetricFormatter;
  // For metrics where higher = better (almost always the case for us)
  // leave higherIsBetter undefined/true. Kept explicit so future "time
  // to first comment"-style metrics can flip the winner logic.
  higherIsBetter?: boolean;
}

const fmtPct: MetricFormatter = (n) => `${n.toFixed(2)}%`;

const METRIC_SECTIONS: Array<{ title: string; metrics: MetricDef[] }> = [
  {
    title: 'Reach',
    metrics: [
      { key: 'impressions', label: 'Impressions', get: (p) => p.impressions },
      { key: 'members_reached', label: 'Members Reached', get: (p) => p.members_reached },
      { key: 'profile_viewers', label: 'Profile Viewers', get: (p) => p.profile_viewers },
    ],
  },
  {
    title: 'Engagement',
    metrics: [
      { key: 'social_engagements', label: 'Total Engagements', get: (p) => p.social_engagements },
      { key: 'engagement_rate', label: 'Engagement Rate', get: (p) => p.engagement_rate, format: fmtPct },
      { key: 'reactions', label: 'Reactions', get: (p) => p.reactions },
      { key: 'comments', label: 'Comments', get: (p) => p.comments },
      { key: 'reposts', label: 'Reposts', get: (p) => p.reposts },
      { key: 'saves', label: 'Saves', get: (p) => p.saves },
      { key: 'sends', label: 'Sends', get: (p) => p.sends },
    ],
  },
  {
    title: 'Impact',
    metrics: [
      { key: 'followers_gained', label: 'Followers Gained', get: (p) => p.followers_gained },
    ],
  },
  {
    title: 'Content stats',
    metrics: [
      { key: 'word_count', label: 'Word Count', get: (p) => p.word_count },
      { key: 'paragraph_count', label: 'Paragraphs', get: (p) => p.paragraph_count },
      { key: 'feature_count', label: 'Feature Count', get: (p) => p.feature_count },
    ],
  },
];

// Content-score weights.
//   Simple rule: each present feature adds +1, absent adds 0.
//   External link is the lone penalty — present → −1 (LinkedIn is
//   known to deprioritize posts with off-platform links), absent → 0.
//   Swap in data-driven weights later if we want to ground this in
//   Pedro's actual engagement history.
interface FeatureWeight {
  key: keyof Post;
  label: string;
  presentWeight: number;
  absentWeight: number;
}

const FEATURE_WEIGHTS: FeatureWeight[] = [
  { key: 'has_image', label: 'Image', presentWeight: 1, absentWeight: 0 },
  { key: 'has_link', label: 'External link', presentWeight: -1, absentWeight: 0 },
  { key: 'has_emoji', label: 'Emoji', presentWeight: 1, absentWeight: 0 },
  { key: 'has_question', label: 'Question', presentWeight: 1, absentWeight: 0 },
  { key: 'has_bullet_points', label: 'Bullet points', presentWeight: 1, absentWeight: 0 },
  { key: 'has_bold_unicode', label: 'Bold unicode', presentWeight: 1, absentWeight: 0 },
];

function contentScore(post: Post): number {
  return FEATURE_WEIGHTS.reduce((sum, f) => {
    const has = !!post[f.key];
    return sum + (has ? f.presentWeight : f.absentWeight);
  }, 0);
}

export default function CompareClient({ posts }: CompareClientProps) {
  const [post1Id, setPost1Id] = useState<string>('');
  const [post2Id, setPost2Id] = useState<string>('');

  const post1 = post1Id ? posts.find((p) => p.activity_id === post1Id) : undefined;
  const post2 = post2Id ? posts.find((p) => p.activity_id === post2Id) : undefined;

  const getPostOption = (post: Post) => {
    const date = formatDate(post.post_date);
    return `${date} - ${truncateChars(post.post_content, 60)}`;
  };

  const swap = () => {
    setPost1Id(post2Id);
    setPost2Id(post1Id);
  };

  // --- Shortlists to scaffold post selection -------------------------------
  // Best: top 5 by engagement_rate (no impressions floor — a small post
  //   with genuinely high ER is still informative).
  // Worst: bottom 3 by engagement_rate among posts with ≥500 impressions,
  //   so a post that went unseen doesn't end up labeled "worst" just
  //   because 0/12 happens to round to 0%.
  const bestFive = useMemo(
    () =>
      [...posts]
        .filter((p) => p.impressions > 0)
        .sort((a, b) => b.engagement_rate - a.engagement_rate)
        .slice(0, 5),
    [posts],
  );
  const worstThree = useMemo(
    () =>
      [...posts]
        .filter((p) => p.impressions >= 500)
        .sort((a, b) => a.engagement_rate - b.engagement_rate)
        .slice(0, 3),
    [posts],
  );

  // --- Wins tally across all numeric metrics -------------------------------
  const wins = useMemo(() => {
    if (!post1 || !post2) return null;
    let w1 = 0;
    let w2 = 0;
    let total = 0;
    for (const section of METRIC_SECTIONS) {
      for (const m of section.metrics) {
        total++;
        const v1 = m.get(post1);
        const v2 = m.get(post2);
        const higher = m.higherIsBetter !== false;
        if (v1 === v2) continue;
        const winner = higher ? (v1 > v2 ? 1 : 2) : v1 < v2 ? 1 : 2;
        if (winner === 1) w1++;
        else w2++;
      }
    }
    return { w1, w2, total };
  }, [post1, post2]);

  return (
    <div className="space-y-6">
      {/* Section heading — embedded inside /posts above the explorer.
          Used to be a standalone /compare page; merged in 2026-05. */}
      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Post Comparison
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Head-to-head view — pick two posts and bars grow from the center toward each side.
        </p>
      </div>

      {/* Shortlists: top performers + bottom performers.
          Use them as quick-pick entry points for the pickers below. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ShortlistTable
          title="Top 5 by engagement rate"
          emptyMessage="No posts with impressions yet."
          rows={bestFive}
          onPickA={setPost1Id}
          onPickB={setPost2Id}
          selectedA={post1Id}
          selectedB={post2Id}
        />
        <ShortlistTable
          title="Bottom 3 by engagement rate"
          subtitle="Posts with ≥500 impressions (filters out tiny samples)"
          emptyMessage="No posts with ≥500 impressions yet."
          rows={worstThree}
          onPickA={setPost1Id}
          onPickB={setPost2Id}
          selectedA={post1Id}
          selectedB={post2Id}
        />
      </div>

      {/* Selectors + swap button */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
        <PostPicker
          id="post1"
          label="Post A"
          value={post1Id}
          onChange={setPost1Id}
          posts={posts}
          getPostOption={getPostOption}
          post={post1}
          align="left"
        />
        <div className="flex md:flex-col items-center justify-center pt-8">
          <button
            type="button"
            onClick={swap}
            disabled={!post1 || !post2}
            className="text-sm px-3 py-1.5 rounded font-medium disabled:opacity-40 transition-colors"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
            title="Swap posts"
          >
            ⇄ Swap
          </button>
        </div>
        <PostPicker
          id="post2"
          label="Post B"
          value={post2Id}
          onChange={setPost2Id}
          posts={posts}
          getPostOption={getPostOption}
          post={post2}
          align="right"
        />
      </div>

      {/* Content scorecards — one per post. "Leading" badge only once
          both posts are chosen so we can compare totals. */}
      {(post1 || post2) && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
          <div>
            {post1 ? (
              <ContentScoreCard
                post={post1}
                side="A"
                leading={
                  post1 && post2
                    ? contentScore(post1) > contentScore(post2)
                    : null
                }
              />
            ) : (
              <div
                className="card text-sm italic text-center py-8"
                style={{ color: 'var(--text-muted)' }}
              >
                Pick a Post A to see its content score.
              </div>
            )}
          </div>
          {/* Keep the center column empty so the scorecards line up
              horizontally with the pickers + ⇄ swap button above. */}
          <div className="hidden md:block" style={{ width: '1px' }} />
          <div>
            {post2 ? (
              <ContentScoreCard
                post={post2}
                side="B"
                leading={
                  post1 && post2
                    ? contentScore(post2) > contentScore(post1)
                    : null
                }
              />
            ) : (
              <div
                className="card text-sm italic text-center py-8"
                style={{ color: 'var(--text-muted)' }}
              >
                Pick a Post B to see its content score.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main comparison */}
      {post1 && post2 ? (
        <>
          {/* Wins summary */}
          {wins && (
            <div className="card">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <WinsBadge
                  side="A"
                  wins={wins.w1}
                  total={wins.total}
                  leading={wins.w1 > wins.w2}
                />
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Scoreboard
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {wins.w1 + wins.w2} of {wins.total} metrics decided
                    {wins.total - wins.w1 - wins.w2 > 0 &&
                      `  ·  ${wins.total - wins.w1 - wins.w2} tied`}
                  </div>
                </div>
                <WinsBadge
                  side="B"
                  wins={wins.w2}
                  total={wins.total}
                  leading={wins.w2 > wins.w1}
                />
              </div>
            </div>
          )}

          {/* Metric sections */}
          {METRIC_SECTIONS.map((section) => (
            <div key={section.title} className="card">
              <h3 className="section-title">{section.title}</h3>
              <div className="space-y-3">
                {section.metrics.map((m) => (
                  <DivergingBarRow
                    key={m.key}
                    label={m.label}
                    value1={m.get(post1)}
                    value2={m.get(post2)}
                    formatter={m.format ?? formatNumber}
                    higherIsBetter={m.higherIsBetter !== false}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Demographics — kept as before, condensed */}
          {(post1.demographics || post2.demographics) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {post1.demographics && (
                <div className="card">
                  <h3 className="section-title">Post A — demographics</h3>
                  <DemographicsStack demos={post1.demographics} />
                </div>
              )}
              {post2.demographics && (
                <div className="card">
                  <h3 className="section-title">Post B — demographics</h3>
                  <DemographicsStack demos={post2.demographics} />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div
          className="card text-center py-12"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
        >
          <p style={{ color: 'var(--text-secondary)' }}>
            Pick two posts to see a head-to-head comparison.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PostPicker — select + preview card for a single post.
// ---------------------------------------------------------------------------
function PostPicker({
  id,
  label,
  value,
  onChange,
  posts,
  getPostOption,
  post,
  align,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  posts: Post[];
  getPostOption: (p: Post) => string;
  post: Post | undefined;
  align: 'left' | 'right';
}) {
  const sideColor = align === 'left' ? 'var(--accent)' : 'var(--warning)';
  return (
    <div className="card">
      <label
        htmlFor={id}
        className="block font-semibold mb-2 text-xs uppercase tracking-wide"
        style={{ color: sideColor }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border text-sm"
        style={{
          borderColor: 'var(--border)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="">Select a post…</option>
        {posts.map((p) => (
          <option key={p.activity_id} value={p.activity_id}>
            {getPostOption(p)}
          </option>
        ))}
      </select>
      {post && (
        <div
          className="mt-3 p-3 rounded-lg text-sm"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            <span>{formatDate(post.post_date)}</span>
            <span>·</span>
            <span>{post.topic}</span>
            <span>·</span>
            <span>{post.style}</span>
          </div>
          <p className="line-clamp-3" style={{ color: 'var(--text-primary)' }}>
            {post.post_content}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WinsBadge — big number showing metric-wins count per side.
// ---------------------------------------------------------------------------
function WinsBadge({
  side,
  wins,
  total,
  leading,
}: {
  side: 'A' | 'B';
  wins: number;
  total: number;
  leading: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center px-6 py-3 rounded-lg"
      style={{
        backgroundColor: leading ? 'rgba(5, 118, 66, 0.1)' : 'var(--bg-secondary)',
        border: `1px solid ${leading ? 'var(--success)' : 'var(--border)'}`,
        minWidth: '140px',
      }}
    >
      <div
        className="text-xs uppercase tracking-wide"
        style={{ color: leading ? 'var(--success)' : 'var(--text-muted)' }}
      >
        Post {side} {leading && '· leading'}
      </div>
      <div
        className="text-3xl font-bold mt-1"
        style={{ color: leading ? 'var(--success)' : 'var(--text-primary)' }}
      >
        {wins}
      </div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        of {total} metrics
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DivergingBarRow — the core "tornado" layout element.
//
// Row is three flex regions: [left value + left bar | metric label | right bar + right value]
// Left half bar is right-aligned so it grows toward the center.
// Right half bar is left-aligned so it grows away from the center.
// Width of each bar is (value / max(v1, v2)) * 100% of its half.
// ---------------------------------------------------------------------------
function DivergingBarRow({
  label,
  value1,
  value2,
  formatter,
  higherIsBetter,
}: {
  label: string;
  value1: number;
  value2: number;
  formatter: (n: number) => string;
  higherIsBetter: boolean;
}) {
  const max = Math.max(value1, value2, 0);
  // Avoid NaN when both are zero
  const pct1 = max > 0 ? (value1 / max) * 100 : 0;
  const pct2 = max > 0 ? (value2 / max) * 100 : 0;

  const isTie = value1 === value2;
  const winner: 0 | 1 | 2 = isTie
    ? 0
    : higherIsBetter
      ? value1 > value2
        ? 1
        : 2
      : value1 < value2
        ? 1
        : 2;

  const color1 = isTie ? 'var(--text-muted)' : winner === 1 ? 'var(--success)' : '#dc2626';
  const color2 = isTie ? 'var(--text-muted)' : winner === 2 ? 'var(--success)' : '#dc2626';

  return (
    <div>
      {/* Centered label on top */}
      <div
        className="text-xs text-center mb-1 uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      <div className="grid grid-cols-[1fr_1fr] items-center gap-0">
        {/* Left half */}
        <div className="flex items-center justify-end gap-2 pr-2">
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: color1 }}
          >
            {formatter(value1)}
          </span>
          <div
            className="h-5 rounded-l-sm transition-all"
            style={{
              width: `${pct1}%`,
              backgroundColor: color1,
              opacity: isTie ? 0.35 : winner === 1 ? 0.85 : 0.45,
              minWidth: pct1 > 0 ? '2px' : '0',
            }}
            aria-hidden
          />
        </div>
        {/* Right half */}
        <div className="flex items-center justify-start gap-2 pl-2">
          <div
            className="h-5 rounded-r-sm transition-all"
            style={{
              width: `${pct2}%`,
              backgroundColor: color2,
              opacity: isTie ? 0.35 : winner === 2 ? 0.85 : 0.45,
              minWidth: pct2 > 0 ? '2px' : '0',
            }}
            aria-hidden
          />
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: color2 }}
          >
            {formatter(value2)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShortlistTable — compact table of 5 best / 3 worst posts with inline
// "A" / "B" quick-pick buttons that populate the selectors below.
// ---------------------------------------------------------------------------
function ShortlistTable({
  title,
  subtitle,
  emptyMessage,
  rows,
  onPickA,
  onPickB,
  selectedA,
  selectedB,
}: {
  title: string;
  subtitle?: string;
  emptyMessage: string;
  rows: Post[];
  onPickA: (id: string) => void;
  onPickB: (id: string) => void;
  selectedA: string;
  selectedB: string;
}) {
  return (
    <div className="card">
      <h3 className="section-title">{title}</h3>
      {subtitle && (
        <p className="text-xs -mt-2 mb-3" style={{ color: 'var(--text-muted)' }}>
          {subtitle}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm italic py-4" style={{ color: 'var(--text-muted)' }}>
          {emptyMessage}
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((post) => {
              const isA = selectedA === post.activity_id;
              const isB = selectedB === post.activity_id;
              return (
                <tr
                  key={post.activity_id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td className="py-2 pr-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(post.post_date)}
                  </td>
                  <td className="py-2 px-2" style={{ color: 'var(--text-primary)' }}>
                    <Link
                      href={`/posts/${post.activity_id}`}
                      className="line-clamp-2 hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {truncateChars(post.post_content, 70)}
                    </Link>
                  </td>
                  <td
                    className="py-2 px-2 text-right tabular-nums font-semibold whitespace-nowrap"
                    style={{ color: 'var(--accent)' }}
                  >
                    {post.engagement_rate.toFixed(2)}%
                  </td>
                  <td className="py-2 pl-2">
                    <div className="flex gap-1 justify-end">
                      <PickButton
                        side="A"
                        active={isA}
                        onClick={() => onPickA(post.activity_id)}
                      />
                      <PickButton
                        side="B"
                        active={isB}
                        onClick={() => onPickB(post.activity_id)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PickButton({
  side,
  active,
  onClick,
}: {
  side: 'A' | 'B';
  active: boolean;
  onClick: () => void;
}) {
  const sideColor = side === 'A' ? 'var(--accent)' : 'var(--warning)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-semibold w-7 h-7 rounded transition-colors"
      style={{
        backgroundColor: active ? sideColor : 'var(--bg-secondary)',
        color: active ? 'white' : sideColor,
        border: `1px solid ${sideColor}`,
      }}
      title={`Load as Post ${side}`}
    >
      {side}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ContentScoreCard — per-post scorecard summing feature weights.
// ---------------------------------------------------------------------------
function ContentScoreCard({
  post,
  side,
  leading,
}: {
  post: Post;
  side: 'A' | 'B';
  leading: boolean | null;
}) {
  const sideColor = side === 'A' ? 'var(--accent)' : 'var(--warning)';
  const score = contentScore(post);
  const scoreColor =
    leading === true
      ? 'var(--success)'
      : leading === false
        ? '#dc2626'
        : 'var(--text-primary)';
  const scoreLabel = score > 0 ? `+${score}` : String(score);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3
          className="font-semibold text-sm uppercase tracking-wide"
          style={{ color: sideColor }}
        >
          Post {side} — content score
        </h3>
        {leading === true && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded"
            style={{
              backgroundColor: 'rgba(5, 118, 66, 0.12)',
              color: 'var(--success)',
            }}
          >
            ★ Leading
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {FEATURE_WEIGHTS.map((f) => {
            const has = !!post[f.key];
            const pts = has ? f.presentWeight : f.absentWeight;
            const mark = has ? '✓' : '✗';
            const markColor = has
              ? f.presentWeight < 0
                ? '#dc2626'
                : 'var(--success)'
              : 'var(--text-muted)';
            const ptsColor =
              pts > 0
                ? 'var(--success)'
                : pts < 0
                  ? '#dc2626'
                  : 'var(--text-muted)';
            const ptsLabel =
              pts > 0 ? `+${pts}` : pts === 0 ? '0' : String(pts);
            return (
              <tr
                key={f.key as string}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <td
                  className="py-2 pr-3 text-base font-semibold"
                  style={{ color: markColor, width: '1.5rem' }}
                >
                  {mark}
                </td>
                <td className="py-2" style={{ color: 'var(--text-primary)' }}>
                  {f.label}
                </td>
                <td
                  className="py-2 text-right tabular-nums font-semibold"
                  style={{ color: ptsColor }}
                >
                  {ptsLabel}
                </td>
              </tr>
            );
          })}
          <tr>
            <td
              colSpan={2}
              className="pt-3 text-sm font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-primary)' }}
            >
              Content score
            </td>
            <td
              className="pt-3 text-right text-lg font-bold tabular-nums"
              style={{ color: scoreColor }}
            >
              {scoreLabel}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demographics — a vertical stack of three categories (seniority / location /
// job_title), each with top 5 entries as progress bars.
// ---------------------------------------------------------------------------
function DemographicsStack({ demos }: { demos: Demographics }) {
  const categories: Array<{ field: keyof Demographics; title: string }> = [
    { field: 'seniority', title: 'Top seniority levels' },
    { field: 'location', title: 'Top locations' },
    { field: 'job_title', title: 'Top job titles' },
  ];
  return (
    <div className="space-y-5">
      {categories.map(({ field, title }) => {
        const list = demos[field];
        if (!list || list.length === 0) return null;
        return (
          <div key={field as string}>
            <h4 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h4>
            <div className="space-y-2">
              {list.slice(0, 5).map((entry) => {
                const pct = parsePct(entry.pct);
                return (
                  <div key={entry.value}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>{entry.value}</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {entry.pct}
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full"
                      style={{ backgroundColor: 'var(--border)', overflow: 'hidden' }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          backgroundColor: 'var(--accent)',
                          height: '100%',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
