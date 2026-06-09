import React from 'react';
import { getProfile, getFollowerHistory } from '@/lib/queries';
import { getConnections } from '@/lib/data-csv';
import { CareerTimeline } from '@/components/charts/CareerTimeline';
import { MetricCard } from '@/components/cards/MetricCard';
import { NetworkCharts } from '@/components/charts/NetworkCharts';

export const dynamic = 'force-dynamic';

export default async function NetworkPage() {
  const [profile, followerHistory, connections] = await Promise.all([
    getProfile(),
    getFollowerHistory(),
    getConnections(),
  ]);

  // Your career timeline. This is static bio data — NOT captured by the
  // analytics pipeline — so populate it with your own positions, or leave
  // it empty to hide the career stats + timeline entirely. Date format is
  // "Mon YYYY"; use 'present' as the endDate for current roles.
  const positions: {
    company: string;
    title: string;
    startDate: string;
    endDate: string;
  }[] = [];

  // Career stats derived from `positions` (shown only when you add some).
  const activeRoles = positions.filter((p) => p.endDate === 'present').length;
  const startYears = positions
    .map((p) => parseInt(p.startDate.split(' ')[1], 10))
    .filter((y) => !Number.isNaN(y));
  const yearsExperience = startYears.length
    ? new Date().getFullYear() - Math.min(...startYears)
    : 0;

  // Connection growth by year
  const growthByYear: { year: string; count: number; cumulative: number }[] = [];
  const yearCounts = new Map<string, number>();
  connections.forEach(c => {
    // "Connected On" format: "10 Apr 2026"
    const match = c.connectedOn.match(/(\d{4})/);
    if (match) {
      const year = match[1];
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    }
  });
  let cumulative = 0;
  Array.from(yearCounts.entries()).sort().forEach(([year, count]) => {
    cumulative += count;
    growthByYear.push({ year, count, cumulative });
  });
  // Display newest year first (reverse chronological).
  const growthByYearDesc = [...growthByYear].sort((a, b) => b.year.localeCompare(a.year));

  // Monthly follower growth — derived from profile_snapshots. We only
  // have ~13 months of follower history (Phase 3c backfill), so a yearly
  // table collapses everything into 2025/2026. Bucket by month instead:
  // pick the last available reading per month, take month-over-month
  // delta. The first month shows its absolute count (no prior reading
  // to subtract from).
  const followersByMonth = new Map<string, number>();
  for (const point of followerHistory) {
    const month = point.date.slice(0, 7);
    followersByMonth.set(month, point.total_followers);
  }
  const followerMonthsAsc = [...followersByMonth.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  type FollowerMonthRow = {
    monthIso: string;
    monthLabel: string;
    gained: number;
    total: number;
  };
  const followerMonthRows: FollowerMonthRow[] = [];
  let prevTotal: number | null = null;
  for (const [month, total] of followerMonthsAsc) {
    const gained = prevTotal === null ? total : total - prevTotal;
    const monthLabel = new Date(month + '-01T00:00:00Z').toLocaleDateString(
      'en-US',
      { month: 'short', year: 'numeric', timeZone: 'UTC' },
    );
    followerMonthRows.push({ monthIso: month, monthLabel, gained, total });
    prevTotal = total;
  }
  const followerMonthRowsDesc = [...followerMonthRows].sort((a, b) =>
    b.monthIso.localeCompare(a.monthIso),
  );
  // Skip the first row when scaling the bar — its "gained" is the
  // absolute count and dwarfs the actual monthly deltas.
  const maxFollowerGain = Math.max(
    1,
    ...followerMonthRows.slice(1).map((r) => Math.abs(r.gained)),
  );

  // Top companies in network
  const companyCounts = new Map<string, number>();
  connections.forEach(c => {
    if (c.company && c.company.trim()) {
      const co = c.company.trim();
      companyCounts.set(co, (companyCounts.get(co) || 0) + 1);
    }
  });
  const topCompanies = Array.from(companyCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([company, count]) => ({ company, count }));

  // Top positions/roles
  const positionCounts = new Map<string, number>();
  connections.forEach(c => {
    if (c.position && c.position.trim()) {
      const pos = c.position.trim();
      positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
    }
  });
  const topPositions = Array.from(positionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([position, count]) => ({ position, count }));

  // Connections added last 12 months
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const recentConnections = connections.filter(c => {
    const match = c.connectedOn.match(/(\d{1,2}) (\w+) (\d{4})/);
    if (!match) return false;
    const d = new Date(`${match[2]} ${match[1]}, ${match[3]}`);
    return d >= oneYearAgo;
  }).length;

  // Growth by month (last 12 months)
  const monthCounts = new Map<string, number>();
  connections.forEach(c => {
    const match = c.connectedOn.match(/(\d{1,2}) (\w+) (\d{4})/);
    if (!match) return;
    const d = new Date(`${match[2]} ${match[1]}, ${match[3]}`);
    if (d >= oneYearAgo) {
      const m = d.toISOString().substring(0, 7);
      monthCounts.set(m, (monthCounts.get(m) || 0) + 1);
    }
  });
  const monthlyGrowth = Array.from(monthCounts.entries())
    .sort()
    .map(([month, count]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      count,
    }));

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Network & Profile
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {connections.length.toLocaleString()} connections analyzed from LinkedIn export
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Connections"
          value={connections.length.toLocaleString()}
          change={`+${recentConnections} last 12 months`}
          changeType="positive"
        />
        <MetricCard
          label="Total Followers"
          value={profile.total_followers.toLocaleString()}
          change={`+${profile.follower_growth_12mo.toLocaleString()} last 12mo`}
          changeType="positive"
        />
        <MetricCard
          label="Companies in Network"
          value={companyCounts.size.toLocaleString()}
          change={`Top: ${topCompanies[0]?.company || 'N/A'}`}
          changeType="positive"
        />
        <MetricCard
          label="Unique Roles"
          value={positionCounts.size.toLocaleString()}
          change={`Top: ${topPositions[0]?.position || 'N/A'}`}
          changeType="positive"
        />
      </div>

      {/* Connection Growth + Top Companies charts */}
      <NetworkCharts
        monthlyGrowth={monthlyGrowth}
        topCompanies={topCompanies}
      />

      {/* Profile Card */}
      <div className="card">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {profile.name}
            </h2>
            <p className="text-lg mt-1" style={{ color: 'var(--text-secondary)' }}>
              {profile.title}
            </p>
          </div>
          {positions.length > 0 && (
            <div className="grid grid-cols-3 gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>
                  {positions.length}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Positions</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: 'var(--success)' }}>{yearsExperience}+</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Years Exp.</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: 'var(--warning)' }}>{activeRoles}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Active Roles</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Career Timeline (hidden until you add positions above) */}
      {positions.length > 0 && <CareerTimeline positions={positions} />}

      {/* Top Roles in Network */}
      <div className="card">
        <h3 className="section-title">Top Roles in Your Network</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {topPositions.slice(0, 10).map((p, idx) => {
            const maxCount = topPositions[0]?.count || 1;
            const barWidth = Math.round((p.count / maxCount) * 100);
            return (
              <div key={idx}>
                <div className="flex justify-between text-sm mb-1">
                  <span style={{ color: 'var(--text-secondary)' }} className="truncate mr-2">
                    {p.position}
                  </span>
                  <span style={{ color: 'var(--text-primary)' }} className="font-medium whitespace-nowrap">
                    {p.count}
                  </span>
                </div>
                <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--border)' }}>
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${barWidth}%`, backgroundColor: 'var(--accent)' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Connection Growth by Year — newest first */}
      <div className="card">
        <h3 className="section-title">Connection Growth Over Time</h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Connections added each year — newest first.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderColor: 'var(--border)' }} className="border-b">
                <th className="text-left py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Year</th>
                <th className="text-right py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>New</th>
                <th className="text-right py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Total</th>
                <th className="text-left py-2 pl-4 font-medium" style={{ color: 'var(--text-secondary)' }}>Growth</th>
              </tr>
            </thead>
            <tbody>
              {growthByYearDesc.map((row) => {
                const maxNew = Math.max(...growthByYearDesc.map(r => r.count));
                const barWidth = Math.round((row.count / maxNew) * 100);
                return (
                  <tr key={row.year} style={{ borderColor: 'var(--border)' }} className="border-b last:border-0">
                    <td className="py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{row.year}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--accent)' }}>+{row.count}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-primary)' }}>{row.cumulative.toLocaleString()}</td>
                    <td className="py-2 pl-4 w-1/3">
                      <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--border)' }}>
                        <div className="h-2 rounded-full" style={{ width: `${barWidth}%`, backgroundColor: 'var(--accent)' }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Follower Growth by Month — newest first. Source data only goes
          back ~13 months (Phase 3c backfill) so a yearly table would
          collapse most of it into one bar; monthly buckets give the
          full available granularity. The first row's "Net Gained"
          shows that month's absolute total (no prior reading to
          subtract from), so it isn't included in the bar scaling. */}
      {followerMonthRowsDesc.length > 0 && (
        <div className="card">
          <h3 className="section-title">Follower Growth Over Time</h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Net followers gained each month — newest first.
          </p>
          <p
            className="text-xs mb-4 mt-2 p-2 rounded"
            style={{
              color: 'var(--text-muted)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <strong>Why only {followerMonthRowsDesc.length} months?</strong>{' '}
            LinkedIn doesn&apos;t expose historical follower counts. The earliest
            reading we have is{' '}
            <strong>
              {followerMonthRowsDesc[followerMonthRowsDesc.length - 1]?.monthLabel}
            </strong>
            , when daily profile snapshots started. Anything before that is gone
            — there&apos;s no API or export to recover it. The first row shows the
            absolute starting count (no prior reading to subtract from).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderColor: 'var(--border)' }} className="border-b">
                  <th className="text-left py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Month</th>
                  <th className="text-right py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Net Gained</th>
                  <th className="text-right py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Total</th>
                  <th className="text-left py-2 pl-4 font-medium" style={{ color: 'var(--text-secondary)' }}>Growth</th>
                </tr>
              </thead>
              <tbody>
                {followerMonthRowsDesc.map((row, idx) => {
                  // The very first month (oldest, last row in desc order)
                  // has gained == absolute starting total, so we don't
                  // render a bar for it — just show the number.
                  const isFirstReading = idx === followerMonthRowsDesc.length - 1;
                  const barWidth = isFirstReading
                    ? 0
                    : Math.round((Math.abs(row.gained) / maxFollowerGain) * 100);
                  return (
                    <tr key={row.monthIso} style={{ borderColor: 'var(--border)' }} className="border-b last:border-0">
                      <td className="py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{row.monthLabel}</td>
                      <td className="py-2 text-right" style={{ color: isFirstReading ? 'var(--text-muted)' : row.gained >= 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                        {isFirstReading
                          ? row.total.toLocaleString()
                          : `${row.gained >= 0 ? '+' : ''}${row.gained.toLocaleString()}`}
                      </td>
                      <td className="py-2 text-right" style={{ color: 'var(--text-primary)' }}>{row.total.toLocaleString()}</td>
                      <td className="py-2 pl-4 w-1/3">
                        {!isFirstReading && (
                          <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--border)' }}>
                            <div className="h-2 rounded-full" style={{ width: `${barWidth}%`, backgroundColor: 'var(--accent)' }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
