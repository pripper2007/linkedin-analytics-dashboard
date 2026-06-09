'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  calculatePostMetrics,
  formatNumber,
  formatDate,
  truncateChars,
} from '@/lib/calculations';
import type { Post } from '@/lib/types';

type SortKey = 'post_date' | 'impressions' | 'engagement_rate' | 'reactions' | 'comments' | 'saves' | 'followers_gained';
type SortDirection = 'asc' | 'desc';

interface PostsListClientProps {
  posts: Post[];
  /** Map of activityId → thumbnail URL (Vercel Blob preferred, LinkedIn
   *  CDN fallback) for posts that have any captured media. Optional so
   *  callers without media coverage info still work. */
  thumbnails?: Record<string, string>;
}

export default function PostsListClient({
  posts,
  thumbnails = {},
}: PostsListClientProps) {
  const metrics = calculatePostMetrics(posts);

  // State for sorting and filtering
  const [sortKey, setSortKey] = useState<SortKey>('post_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [topicFilter, setTopicFilter] = useState<string>('');
  const [styleFilter, setStyleFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  // Posts without snapshot data (legacy URN imports + posts that
  // expired before we could capture analytics) show as all-zero rows.
  // Hide them by default — they pollute the table with noise — but
  // expose a toggle for completeness.
  const [showWithoutData, setShowWithoutData] = useState(false);

  const hiddenWithoutDataCount = useMemo(
    () =>
      posts.filter(
        (p) =>
          p.impressions === 0 &&
          p.reactions === 0 &&
          p.comments === 0 &&
          p.saves === 0,
      ).length,
    [posts],
  );

  // Get unique values for filters
  const topics = useMemo(() => {
    const unique = Array.from(new Set(posts.map(p => p.topic))).sort();
    return unique;
  }, [posts]);

  const styles = useMemo(() => {
    const unique = Array.from(new Set(posts.map(p => p.style))).sort();
    return unique;
  }, [posts]);

  const sources = useMemo(() => {
    const unique = Array.from(new Set(posts.map(p => p.data_source))).sort();
    return unique;
  }, [posts]);

  // Filter and sort posts
  const filteredAndSorted = useMemo(() => {
    let filtered = posts.filter(post => {
      // Hide posts with no analytics data unless explicitly toggled on.
      if (
        !showWithoutData &&
        post.impressions === 0 &&
        post.reactions === 0 &&
        post.comments === 0 &&
        post.saves === 0
      ) {
        return false;
      }
      // Topic filter
      if (topicFilter && post.topic !== topicFilter) return false;
      // Style filter
      if (styleFilter && post.style !== styleFilter) return false;
      // Source filter
      if (sourceFilter && post.data_source !== sourceFilter) return false;
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        if (!post.post_content.toLowerCase().includes(query)) return false;
      }
      return true;
    });

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let aVal: any = a[sortKey];
      let bVal: any = b[sortKey];

      // Handle date sorting
      if (sortKey === 'post_date') {
        aVal = new Date(a.post_date).getTime();
        bVal = new Date(b.post_date).getTime();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [posts, topicFilter, styleFilter, sourceFilter, searchQuery, showWithoutData, sortKey, sortDirection]);

  const handleColumnSort = (key: SortKey) => {
    if (sortKey === key) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDirection === 'desc' ? ' ↓' : ' ↑';
  };

  const isAboveAverage = (value: number, average: number) => {
    return value > average;
  };

  return (
    <div className="space-y-6">
      {/* Section heading — sits below the Compare block on the /posts page.
          Demoted from <h1> when /compare was merged into /posts (2026-05). */}
      <div>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Post Performance Explorer
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Sort, filter, and search the full list of your posts.
        </p>
      </div>

      {/* Filters Card */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Search Content
            </label>
            <input
              type="text"
              placeholder="Search posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Topic Filter */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Topic
            </label>
            <select
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All Topics</option>
              {topics.map(topic => (
                <option key={topic} value={topic}>{topic}</option>
              ))}
            </select>
          </div>

          {/* Style Filter */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Style
            </label>
            <select
              value={styleFilter}
              onChange={(e) => setStyleFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All Styles</option>
              {styles.map(style => (
                <option key={style} value={style}>{style}</option>
              ))}
            </select>
          </div>

          {/* Source Filter */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Data Source
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All Sources</option>
              {sources.map(source => (
                <option key={source} value={source}>
                  {source === 'official_single_post_analytics' ? 'Official Analytics' : 'Scraped'}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Button */}
          <div className="flex items-end">
            <button
              onClick={() => {
                setTopicFilter('');
                setStyleFilter('');
                setSourceFilter('');
                setSearchQuery('');
                setShowWithoutData(false);
              }}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'white',
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Results count + show-without-data toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div style={{ color: 'var(--text-muted)' }}>
          Showing{' '}
          <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>
            {filteredAndSorted.length}
          </span>{' '}
          of <span style={{ fontWeight: 'bold' }}>{posts.length}</span> posts
        </div>
        {hiddenWithoutDataCount > 0 && (
          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            style={{ color: 'var(--text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={showWithoutData}
              onChange={(e) => setShowWithoutData(e.target.checked)}
              className="cursor-pointer"
            />
            <span>
              Show {hiddenWithoutDataCount} post
              {hiddenWithoutDataCount === 1 ? '' : 's'} without analytics
            </span>
          </label>
        )}
      </div>

      {/* Desktop: full 9-col explorer table.
          Mobile (below): a stacked card list with the same data. The
          9-col table doesn't fit on a phone, and horizontal-scrolling
          a sortable table is a bad UX (you'd lose the column header
          while scrolling). The card list keeps each row self-contained. */}
      <div className="card hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th
                className="text-left py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('post_date')}
                style={{ color: 'var(--text-primary)', minWidth: '140px' }}
              >
                Date{getSortIndicator('post_date')}
              </th>
              <th
                className="text-left py-3 px-4 font-semibold"
                style={{ color: 'var(--text-primary)', minWidth: '200px' }}
              >
                Topic / Style
              </th>
              <th
                className="text-left py-3 px-4 font-semibold"
                style={{ color: 'var(--text-primary)', minWidth: '300px' }}
              >
                Content
              </th>
              <th
                className="text-right py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('impressions')}
                style={{ color: 'var(--text-primary)' }}
              >
                Impressions{getSortIndicator('impressions')}
              </th>
              <th
                className="text-right py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('engagement_rate')}
                style={{ color: 'var(--text-primary)' }}
              >
                Eng. Rate{getSortIndicator('engagement_rate')}
              </th>
              <th
                className="text-right py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('reactions')}
                style={{ color: 'var(--text-primary)' }}
              >
                Reactions{getSortIndicator('reactions')}
              </th>
              <th
                className="text-right py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('comments')}
                style={{ color: 'var(--text-primary)' }}
              >
                Comments{getSortIndicator('comments')}
              </th>
              <th
                className="text-right py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('saves')}
                style={{ color: 'var(--text-primary)' }}
              >
                Saves{getSortIndicator('saves')}
              </th>
              <th
                className="text-right py-3 px-4 font-semibold cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => handleColumnSort('followers_gained')}
                style={{ color: 'var(--text-primary)' }}
              >
                Followers{getSortIndicator('followers_gained')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No posts found matching your filters.
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((post) => {
                // A post with engagements but impressions=0 is a partial
                // capture — the analytics scrape grabbed reactions/comments
                // but failed on the impressions field. Showing "0" + "0.00%"
                // is misleading; render "—" instead so missing data is
                // distinguishable from genuine zero.
                const hasEngagementWithoutImpressions =
                  post.impressions === 0 &&
                  (post.reactions > 0 ||
                    post.comments > 0 ||
                    post.saves > 0);
                return (
                <tr
                  key={post.activity_id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                  className="hover:bg-opacity-50 transition-colors cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).tagName !== 'A') {
                      window.location.href = `/posts/${post.activity_id}`;
                    }
                  }}
                >
                  <td className="py-3 px-4" style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(post.post_date)}
                  </td>
                  <td className="py-3 px-4" style={{ color: 'var(--text-primary)' }}>
                    <div className="text-xs font-medium">{post.topic}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {post.style}
                    </div>
                  </td>
                  <td className="py-3 px-4 max-w-xs">
                    <div className="flex items-start gap-2">
                      {thumbnails[post.activity_id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbnails[post.activity_id]}
                          alt=""
                          className="w-10 h-10 rounded object-cover flex-shrink-0"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded flex-shrink-0"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                          aria-hidden
                        />
                      )}
                      <div className="text-xs truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                        {truncateChars(post.post_content, 80)}
                      </div>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4" style={{
                    color: hasEngagementWithoutImpressions
                      ? 'var(--text-muted)'
                      : isAboveAverage(post.impressions, metrics.avgImpressions)
                        ? 'var(--success)'
                        : 'var(--warning)',
                  }}>
                    {hasEngagementWithoutImpressions ? '—' : formatNumber(post.impressions)}
                  </td>
                  <td className="text-right py-3 px-4" style={{
                    color: hasEngagementWithoutImpressions
                      ? 'var(--text-muted)'
                      : 'var(--text-primary)',
                  }}>
                    {hasEngagementWithoutImpressions ? '—' : `${post.engagement_rate.toFixed(2)}%`}
                  </td>
                  <td className="text-right py-3 px-4" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(post.reactions)}
                  </td>
                  <td className="text-right py-3 px-4" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(post.comments)}
                  </td>
                  <td className="text-right py-3 px-4" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(post.saves)}
                  </td>
                  <td className="text-right py-3 px-4" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(post.followers_gained)}
                  </td>
                </tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: same posts as a card stack. Click anywhere on a card to
          navigate to the detail page (matches the desktop row click). */}
      <div className="card md:hidden p-3">
        {filteredAndSorted.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No posts found matching your filters.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {filteredAndSorted.map((post) => {
              const hasEngagementWithoutImpressions =
                post.impressions === 0 &&
                (post.reactions > 0 || post.comments > 0 || post.saves > 0);
              const imprColor = hasEngagementWithoutImpressions
                ? 'var(--text-muted)'
                : isAboveAverage(post.impressions, metrics.avgImpressions)
                  ? 'var(--success)'
                  : 'var(--warning)';
              return (
                <div
                  key={post.activity_id}
                  className="py-3 cursor-pointer"
                  onClick={() => {
                    window.location.href = `/posts/${post.activity_id}`;
                  }}
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatDate(post.post_date)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {post.topic} · {post.style}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    {thumbnails[post.activity_id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnails[post.activity_id]}
                        alt=""
                        className="w-14 h-14 rounded object-cover flex-shrink-0"
                        style={{ backgroundColor: 'var(--bg-secondary)' }}
                        loading="lazy"
                      />
                    ) : null}
                    <div className="text-sm leading-snug mb-2 flex-1" style={{ color: 'var(--text-primary)' }}>
                      {truncateChars(post.post_content, 130)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                    <span style={{ color: imprColor }}>
                      {hasEngagementWithoutImpressions ? '— impr' : `${formatNumber(post.impressions)} impr`}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {hasEngagementWithoutImpressions ? '—' : `${post.engagement_rate.toFixed(2)}%`} ER
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>{formatNumber(post.reactions)} rx</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{formatNumber(post.comments)} cm</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{formatNumber(post.saves)} sv</span>
                    <span style={{ color: 'var(--text-secondary)' }}>+{formatNumber(post.followers_gained)} fol</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
