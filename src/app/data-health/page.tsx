// /data-health — staleness dashboard + AggregateAnalytics xlsx upload.
//
// Surfaces the last-updated timestamps for every table that depends on
// manual LinkedIn exports (daily_engagement, profile_demographics, plus
// the extension-driven profile_snapshots for completeness) and lets the
// user upload a fresh xlsx without touching the terminal. Also explains
// where each piece of data comes from so day-to-day operation is clear.

import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { DataHealthClient } from './DataHealthClient';

export const dynamic = 'force-dynamic';

interface FreshnessRow {
  table: string;
  description: string;
  source: 'xlsx' | 'extension';
  lastDate: string | null;
  daysOld: number | null;
  rows: number;
}

const STALE_THRESHOLD_DAYS = 45;

interface MediaStats {
  totalRows: number;
  postsWithMedia: number;
  mirrored: number;
  unmirrored: number;
}

interface CompleteExportStats {
  comments: number;
  reactions: number;
  connections: number;
  /** Most recent date in any of the three tables, or null if all empty. */
  lastDate: string | null;
  daysOld: number | null;
}

async function getCompleteExportStats(): Promise<CompleteExportStats> {
  const r = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM user_comments) AS comments,
      (SELECT COUNT(*)::int FROM user_reactions) AS reactions,
      (SELECT COUNT(*)::int FROM user_connections) AS connections,
      GREATEST(
        (SELECT MAX(commented_at) FROM user_comments),
        (SELECT MAX(reacted_at) FROM user_reactions)
      )::text AS last_engagement
  `)) as unknown as Array<{
    comments: number;
    reactions: number;
    connections: number;
    last_engagement: string | null;
  }>;
  const row = r[0];
  const lastDate = row?.last_engagement
    ? row.last_engagement.slice(0, 10)
    : null;
  const daysOld =
    lastDate === null
      ? null
      : Math.floor(
          (Date.now() - new Date(`${lastDate}T00:00:00Z`).getTime()) /
            (1000 * 60 * 60 * 24),
        );
  return {
    comments: row?.comments ?? 0,
    reactions: row?.reactions ?? 0,
    connections: row?.connections ?? 0,
    lastDate,
    daysOld,
  };
}

async function getMediaStats(): Promise<MediaStats> {
  const r = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(DISTINCT activity_id)::int AS posts_with_media,
      COUNT(*) FILTER (WHERE blob_url IS NOT NULL)::int AS mirrored,
      COUNT(*) FILTER (WHERE blob_url IS NULL)::int AS unmirrored
    FROM post_media
  `)) as unknown as Array<MediaStats & Record<string, number>>;
  return {
    totalRows: r[0]?.total_rows ?? 0,
    postsWithMedia: r[0]?.posts_with_media ?? 0,
    mirrored: r[0]?.mirrored ?? 0,
    unmirrored: r[0]?.unmirrored ?? 0,
  };
}

async function getFreshness(): Promise<FreshnessRow[]> {
  const r = (await db.execute(sql`
    SELECT
      (SELECT MAX(date)::text FROM daily_engagement) AS daily_engagement_last,
      (SELECT COUNT(*)::int FROM daily_engagement) AS daily_engagement_rows,
      (SELECT MAX(snapshot_date)::text FROM profile_demographics) AS profile_demographics_last,
      (SELECT COUNT(*)::int FROM profile_demographics) AS profile_demographics_rows,
      (SELECT MAX(snapshot_date)::text FROM profile_snapshots) AS profile_snapshots_last,
      (SELECT COUNT(*)::int FROM profile_snapshots) AS profile_snapshots_rows,
      (SELECT MAX(snapshot_date)::text FROM post_snapshots) AS post_snapshots_last,
      (SELECT COUNT(*)::int FROM post_snapshots) AS post_snapshots_rows,
      (SELECT MAX(snapshot_date)::text FROM post_demographics) AS post_demographics_last,
      (SELECT COUNT(*)::int FROM post_demographics) AS post_demographics_rows,
      (SELECT COUNT(*)::int FROM post_media) AS post_media_rows
  `)) as unknown as Array<Record<string, string | number | null>>;

  const row = r[0];
  function daysOld(dateStr: string | null): number | null {
    if (!dateStr) return null;
    const d = new Date(`${dateStr}T00:00:00Z`).getTime();
    return Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24));
  }

  return [
    {
      table: 'post_snapshots',
      description:
        'Per-post daily metrics: impressions, reactions, comments, saves, sends, etc.',
      source: 'extension',
      lastDate: row.post_snapshots_last as string | null,
      daysOld: daysOld(row.post_snapshots_last as string | null),
      rows: (row.post_snapshots_rows as number) ?? 0,
    },
    {
      table: 'post_demographics',
      description:
        'Per-post audience breakdown: who viewed each post (job title, location, etc.)',
      source: 'extension',
      lastDate: row.post_demographics_last as string | null,
      daysOld: daysOld(row.post_demographics_last as string | null),
      rows: (row.post_demographics_rows as number) ?? 0,
    },
    {
      table: 'post_media',
      description: 'Image / video / document URLs attached to each post',
      source: 'extension',
      lastDate: null,
      daysOld: null,
      rows: (row.post_media_rows as number) ?? 0,
    },
    {
      table: 'profile_snapshots',
      description: 'Daily total followers + connections counts',
      source: 'extension',
      lastDate: row.profile_snapshots_last as string | null,
      daysOld: daysOld(row.profile_snapshots_last as string | null),
      rows: (row.profile_snapshots_rows as number) ?? 0,
    },
    {
      table: 'daily_engagement',
      description:
        'Daily impressions + engagements rollup, drives the headline activity charts',
      source: 'xlsx',
      lastDate: row.daily_engagement_last as string | null,
      daysOld: daysOld(row.daily_engagement_last as string | null),
      rows: (row.daily_engagement_rows as number) ?? 0,
    },
    {
      table: 'profile_demographics',
      description:
        'Profile-wide audience breakdown by industry / company / location / seniority',
      source: 'xlsx',
      lastDate: row.profile_demographics_last as string | null,
      daysOld: daysOld(row.profile_demographics_last as string | null),
      rows: (row.profile_demographics_rows as number) ?? 0,
    },
  ];
}

export default async function DataHealthPage() {
  const [freshness, mediaStats, exportStats] = await Promise.all([
    getFreshness(),
    getMediaStats(),
    getCompleteExportStats(),
  ]);
  const xlsxRows = freshness.filter((f) => f.source === 'xlsx');
  const oldestXlsxDays = xlsxRows.reduce<number | null>(
    (m, r) =>
      r.daysOld === null ? m : m === null ? r.daysOld : Math.max(m, r.daysOld),
    null,
  );
  const xlsxLastDate = xlsxRows
    .map((r) => r.lastDate)
    .filter((d): d is string => d !== null)
    .sort()[0] ?? null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-12">
      {/* ------------------------------------------------------------- */}
      {/* Header                                                        */}
      {/* ------------------------------------------------------------- */}
      <header>
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Data Health
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Tracks every data source the dashboard depends on. Refresh the
          manual ones below — no terminal needed.
        </p>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* 1. How data gets in (explainer)                                */}
      {/* ------------------------------------------------------------- */}
      <section>
        <h2
          className="text-xl font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          How data flows into the dashboard
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {/* Source 1: Chrome extension */}
          <div
            className="rounded-lg p-5 border"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#059669',
                }}
              >
                AUTO · DAILY
              </span>
            </div>
            <h3
              className="font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Chrome extension
            </h3>
            <p
              className="text-sm mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Captures per-post analytics + your follower count whenever you
              browse LinkedIn. Runs in the background.
            </p>
            <p
              className="text-xs font-medium mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Feeds:
            </p>
            <ul
              className="text-xs space-y-0.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <li>· post_snapshots (impressions, engagement)</li>
              <li>· post_demographics (per-post audience)</li>
              <li>· post_media (images/videos)</li>
              <li>· profile_snapshots (followers, connections)</li>
            </ul>
            <p
              className="text-xs mt-3 pt-3 border-t"
              style={{
                color: 'var(--text-muted)',
                borderColor: 'var(--border)',
              }}
            >
              <strong>Day-to-day:</strong> nothing. Just leave the extension
              installed and signed into LinkedIn.
            </p>
          </div>

          {/* Source 2: AggregateAnalytics xlsx */}
          <div
            className="rounded-lg p-5 border"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: '#b45309',
                }}
              >
                MANUAL · ~30 DAYS
              </span>
            </div>
            <h3
              className="font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Aggregate Analytics xlsx
            </h3>
            <p
              className="text-sm mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Profile-wide rollups LinkedIn doesn&apos;t expose to the
              extension. Exported from the Analytics page in seconds.
            </p>
            <p
              className="text-xs font-medium mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Feeds:
            </p>
            <ul
              className="text-xs space-y-0.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <li>· daily_engagement (impressions+engagements/day)</li>
              <li>· profile_demographics (your audience)</li>
              <li>· profile_snapshots (historical follower counts)</li>
            </ul>
            <p
              className="text-xs mt-3 pt-3 border-t"
              style={{
                color: 'var(--text-muted)',
                borderColor: 'var(--border)',
              }}
            >
              <strong>Day-to-day:</strong> upload the xlsx below every ~30
              days. Banner appears on the dashboard at 45+ days.
            </p>
          </div>

          {/* Source 3: Complete data export */}
          <div
            className="rounded-lg p-5 border"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-xs px-2 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: 'rgba(99, 102, 241, 0.15)',
                  color: '#4f46e5',
                }}
              >
                MANUAL · ~60-90 DAYS
              </span>
            </div>
            <h3
              className="font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Complete data export
            </h3>
            <p
              className="text-sm mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              Your engagement footprint on others&apos; posts and your full
              connections list. Requested via Settings → Get a copy of your
              data.
            </p>
            <p
              className="text-xs font-medium mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Feeds:
            </p>
            <ul
              className="text-xs space-y-0.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <li>· user_comments (your comments on others)</li>
              <li>· user_reactions (your reactions on others)</li>
              <li>· user_connections (full connection list)</li>
            </ul>
            <p
              className="text-xs mt-3 pt-3 border-t"
              style={{
                color: 'var(--text-muted)',
                borderColor: 'var(--border)',
              }}
            >
              <strong>Day-to-day:</strong> request a refresh every 1–3 months.
              Drop the zip below — no terminal needed.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 2. Sources freshness table                                    */}
      {/* ------------------------------------------------------------- */}
      <section>
        <h2
          className="text-xl font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Current state
        </h2>
        <div
          className="overflow-x-auto rounded-lg border"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <table className="w-full text-sm">
            <thead
              className="text-xs uppercase tracking-wider"
              style={{
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              <tr>
                <th className="px-4 py-3 text-left font-medium">Table</th>
                <th className="px-4 py-3 text-left font-medium">Source</th>
                <th className="px-4 py-3 text-left font-medium">
                  Last entry
                </th>
                <th className="px-4 py-3 text-right font-medium">Days old</th>
                <th className="px-4 py-3 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {freshness.map((f) => {
                const stale =
                  f.source === 'xlsx' &&
                  f.daysOld !== null &&
                  f.daysOld > STALE_THRESHOLD_DAYS;
                return (
                  <tr
                    key={f.table}
                    className="border-t"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="px-4 py-3 align-top">
                      <div
                        className="font-mono text-sm"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {f.table}
                      </div>
                      <div
                        className="text-xs mt-0.5 max-w-md"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {f.description}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
                        style={{
                          backgroundColor:
                            f.source === 'xlsx'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(16, 185, 129, 0.15)',
                          color: f.source === 'xlsx' ? '#b45309' : '#059669',
                        }}
                      >
                        {f.source}
                      </span>
                    </td>
                    <td
                      className="px-4 py-3 align-top"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {f.lastDate ?? '—'}
                    </td>
                    <td
                      className="px-4 py-3 align-top text-right font-medium"
                      style={{
                        color: stale ? '#b45309' : 'var(--text-secondary)',
                      }}
                    >
                      {f.daysOld === null ? '—' : `${f.daysOld}d`}
                    </td>
                    <td
                      className="px-4 py-3 align-top text-right"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {f.rows.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p
          className="text-xs mt-2"
          style={{ color: 'var(--text-muted)' }}
        >
          xlsx-sourced tables are flagged stale at {STALE_THRESHOLD_DAYS}+
          days. extension-sourced tables update daily as long as the Chrome
          extension runs.
        </p>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 3. Upload UI + media mirror (client component)                */}
      {/* ------------------------------------------------------------- */}
      <DataHealthClient
        staleThresholdDays={STALE_THRESHOLD_DAYS}
        xlsxLastDate={xlsxLastDate}
        xlsxDaysOld={oldestXlsxDays}
        mediaStats={mediaStats}
        exportStats={exportStats}
      />
    </div>
  );
}
