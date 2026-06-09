import {
  getDailyEngagement,
  getAllPosts,
  getPostThumbnails,
} from '@/lib/queries';
import {
  calculateMonthlyData,
  formatNumber,
  formatDate,
  truncateChars,
} from '@/lib/calculations';
import PostsListClient from './PostsListClient';
import CompareClient from './CompareClient';

export const dynamic = 'force-dynamic';

export default async function PostsPage() {
  const [posts, dailyEngagement, thumbnails] = await Promise.all([
    getAllPosts(),
    getDailyEngagement(),
    getPostThumbnails(),
  ]);
  // Plain object for client-component prop (Map isn't serializable).
  const thumbnailMap = Object.fromEntries(thumbnails);

  // Leaderboards drop posts with 0 captured impressions — they would tie
  // at the bottom and clutter the table without telling us anything.
  const rankablePosts = posts.filter((p) => p.impressions > 0);

  const bestPostsFollowers = [...rankablePosts]
    .sort((a, b) => b.followers_gained - a.followers_gained)
    .slice(0, 10);

  const bestPostsEngagement = [...rankablePosts]
    .sort((a, b) => b.engagement_rate - a.engagement_rate)
    .slice(0, 10);

  // Posts-per-month vs. impressions-per-month, newest first. Months with
  // no captured impressions hide — those are pre-tracking months where
  // we have a post (Shares.csv backfill) but no daily_engagement rollup.
  const monthlyData = calculateMonthlyData(dailyEngagement);
  const postsPerMonth = new Map<string, number>();
  posts.forEach((p) => {
    const d = new Date(p.post_date);
    if (Number.isNaN(d.getTime())) return;
    const month = d.toISOString().substring(0, 7);
    postsPerMonth.set(month, (postsPerMonth.get(month) || 0) + 1);
  });
  const postFrequencyData = Array.from(postsPerMonth.entries())
    .map(([month, count]) => {
      const monthRow = monthlyData.find((m) => m.month === month);
      const labelDate = new Date(month + '-01T00:00:00Z');
      return {
        monthIso: month,
        month: labelDate.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        posts: count,
        impressions: monthRow?.impressions ?? 0,
      };
    })
    .filter((row) => row.impressions > 0)
    .sort((a, b) => b.monthIso.localeCompare(a.monthIso));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Posts
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Top performers, head-to-head comparison, and the full searchable list.
        </p>
      </div>

      {/* Section 1: Top performers + posting frequency (formerly /growth). */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Post Performance
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Per-post leaderboards and monthly posting cadence — across all posts
            with captured analytics.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="section-title">Top 10 Posts for Follower Growth</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Posts that converted reach into followers, ordered by net followers
              gained.
            </p>
            {bestPostsFollowers.length === 0 ? (
              <div className="text-sm italic py-4" style={{ color: 'var(--text-muted)' }}>
                No posts with captured analytics.
              </div>
            ) : (
              <>
                {/* Desktop: 3-col table. Mobile: card stack. */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottomColor: 'var(--border)' }} className="border-b">
                        <th style={{ color: 'var(--text-secondary)' }} className="text-left py-2 px-3 font-medium">Date</th>
                        <th style={{ color: 'var(--text-secondary)' }} className="text-left py-2 px-3 font-medium">Content</th>
                        <th style={{ color: 'var(--text-secondary)' }} className="text-right py-2 px-3 font-medium">Followers Gained</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bestPostsFollowers.map((post) => (
                        <tr key={post.activity_id} style={{ borderBottomColor: 'var(--border)' }} className="border-b last:border-b-0">
                          <td style={{ color: 'var(--text-secondary)' }} className="py-3 px-3 text-xs whitespace-nowrap">{formatDate(post.post_date)}</td>
                          <td style={{ color: 'var(--text-primary)' }} className="py-3 px-3 max-w-xs truncate">{truncateChars(post.post_content, 60)}</td>
                          <td style={{ color: 'var(--success)' }} className="py-3 px-3 text-right font-semibold whitespace-nowrap">+{post.followers_gained}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden divide-y" style={{ borderColor: 'var(--border)' }}>
                  {bestPostsFollowers.map((post) => (
                    <div key={post.activity_id} className="py-3" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {formatDate(post.post_date)}
                        </span>
                        <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--success)' }}>
                          +{post.followers_gained} followers
                        </span>
                      </div>
                      <div className="text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                        {truncateChars(post.post_content, 110)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3 className="section-title">Top 10 Posts by Engagement Rate</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Posts with the strongest engagement-per-impression ratio.
            </p>
            {bestPostsEngagement.length === 0 ? (
              <div className="text-sm italic py-4" style={{ color: 'var(--text-muted)' }}>
                No posts with captured analytics.
              </div>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottomColor: 'var(--border)' }} className="border-b">
                        <th style={{ color: 'var(--text-secondary)' }} className="text-left py-2 px-3 font-medium">Date</th>
                        <th style={{ color: 'var(--text-secondary)' }} className="text-left py-2 px-3 font-medium">Content</th>
                        <th style={{ color: 'var(--text-secondary)' }} className="text-right py-2 px-3 font-medium">Engagement Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bestPostsEngagement.map((post) => (
                        <tr key={post.activity_id} style={{ borderBottomColor: 'var(--border)' }} className="border-b last:border-b-0">
                          <td style={{ color: 'var(--text-secondary)' }} className="py-3 px-3 text-xs whitespace-nowrap">{formatDate(post.post_date)}</td>
                          <td style={{ color: 'var(--text-primary)' }} className="py-3 px-3 max-w-xs truncate">{truncateChars(post.post_content, 60)}</td>
                          <td style={{ color: 'var(--accent)' }} className="py-3 px-3 text-right font-semibold whitespace-nowrap">{post.engagement_rate.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden divide-y" style={{ borderColor: 'var(--border)' }}>
                  {bestPostsEngagement.map((post) => (
                    <div key={post.activity_id} className="py-3" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {formatDate(post.post_date)}
                        </span>
                        <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--accent)' }}>
                          {post.engagement_rate.toFixed(2)}% ER
                        </span>
                      </div>
                      <div className="text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                        {truncateChars(post.post_content, 110)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">Posting Frequency & Impact</h3>
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm mb-2">
            Posts published each month and the impressions they drove. Newest
            first; months with no captured impressions are hidden.
          </p>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-6">
            <strong>Avg per Post</strong> = total monthly impressions ÷ posts
            published that month.
          </p>
          {postFrequencyData.length === 0 ? (
            <div className="text-sm italic py-4" style={{ color: 'var(--text-muted)' }}>
              No months with captured impressions.
            </div>
          ) : (
            <>
              {/* Desktop: 4-col table. */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottomColor: 'var(--border)' }} className="border-b">
                      <th style={{ color: 'var(--text-secondary)' }} className="text-left py-2 px-3 font-medium">Month</th>
                      <th style={{ color: 'var(--text-secondary)' }} className="text-center py-2 px-3 font-medium">Posts</th>
                      <th style={{ color: 'var(--text-secondary)' }} className="text-right py-2 px-3 font-medium">Total Impressions</th>
                      <th style={{ color: 'var(--text-secondary)' }} className="text-right py-2 px-3 font-medium">Avg per Post</th>
                    </tr>
                  </thead>
                  <tbody>
                    {postFrequencyData.map((item) => (
                      <tr key={item.monthIso} style={{ borderBottomColor: 'var(--border)' }} className="border-b last:border-b-0">
                        <td style={{ color: 'var(--text-primary)' }} className="py-3 px-3 font-medium">{item.month}</td>
                        <td style={{ color: 'var(--accent)' }} className="py-3 px-3 text-center font-semibold">{item.posts}</td>
                        <td style={{ color: 'var(--text-primary)' }} className="py-3 px-3 text-right font-semibold">{formatNumber(item.impressions)}</td>
                        <td style={{ color: 'var(--text-secondary)' }} className="py-3 px-3 text-right">
                          {item.posts > 0 ? formatNumber(Math.round(item.impressions / item.posts)) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile: each month is a card with a 3-col mini-grid. */}
              <div className="md:hidden space-y-3">
                {postFrequencyData.map((item) => (
                  <div
                    key={item.monthIso}
                    className="rounded-lg border p-3"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                      {item.month}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Posts</div>
                        <div className="tabular-nums font-semibold" style={{ color: 'var(--accent)' }}>{item.posts}</div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Impr.</div>
                        <div className="tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {formatNumber(item.impressions)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Avg / Post</div>
                        <div className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {item.posts > 0 ? formatNumber(Math.round(item.impressions / item.posts)) : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Section 2: Head-to-head Compare (formerly /compare). */}
      <CompareClient posts={posts} />

      {/* Section 3: Full filterable list. */}
      <PostsListClient posts={posts} thumbnails={thumbnailMap} />
    </div>
  );
}
