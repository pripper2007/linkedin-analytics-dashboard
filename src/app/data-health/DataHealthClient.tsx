'use client';

// Client-side xlsx upload + LinkedIn export instructions. Server data
// (last-updated dates, days-old, etc.) is rendered above this in the
// server component; this island only handles the interactive bits.

import { useState } from 'react';

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
  lastDate: string | null;
  daysOld: number | null;
}

interface Props {
  staleThresholdDays: number;
  xlsxLastDate: string | null;
  xlsxDaysOld: number | null;
  mediaStats: MediaStats;
  exportStats: CompleteExportStats;
}

interface UploadSummary {
  engagementRows: number;
  followerRows: number;
  followerAnchorDate: string;
  followerAnchorTotal: number;
  demographicRows: number;
}

interface MirrorBatchSummary {
  mirrored: number;
  alreadyMirrored: number;
  failed: number;
  remaining: number;
  failures: Array<{ activityId: string; sourceUrl: string; reason: string }>;
}

interface CompleteExportSummary {
  comments: number;
  reactions: number;
  connections: number;
  filesFound: string[];
}

export function DataHealthClient({
  staleThresholdDays,
  xlsxLastDate,
  xlsxDaysOld,
  mediaStats,
  exportStats,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mirroring, setMirroring] = useState(false);
  const [mirrorResult, setMirrorResult] = useState<MirrorBatchSummary | null>(
    null,
  );
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const [zipUploading, setZipUploading] = useState(false);
  const [zipDragOver, setZipDragOver] = useState(false);
  const [zipResult, setZipResult] = useState<CompleteExportSummary | null>(
    null,
  );
  const [zipError, setZipError] = useState<string | null>(null);

  const isStale =
    xlsxDaysOld !== null && xlsxDaysOld > staleThresholdDays;
  const daysUntilStale =
    xlsxDaysOld === null ? null : staleThresholdDays - xlsxDaysOld;

  async function uploadFile(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    setSummary(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/import-aggregate-xlsx', {
        method: 'POST',
        body: fd,
        // Cookies (including dashboard_session) are sent automatically
        // for same-origin requests; no Authorization header needed.
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(
          `Upload failed (${resp.status}): ${data.error ?? 'unknown'}${data.message ? ' — ' + data.message : ''}`,
        );
        return;
      }
      setSummary(data.summary as UploadSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function uploadZip(file: File): Promise<void> {
    setZipUploading(true);
    setZipError(null);
    setZipResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch('/api/import-complete-export', {
        method: 'POST',
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setZipError(
          `Upload failed (${resp.status}): ${data.error ?? 'unknown'}${data.message ? ' — ' + data.message : ''}`,
        );
        return;
      }
      setZipResult(data.summary as CompleteExportSummary);
    } catch (e) {
      setZipError(e instanceof Error ? e.message : String(e));
    } finally {
      setZipUploading(false);
    }
  }

  async function runMirror(): Promise<void> {
    setMirroring(true);
    setMirrorError(null);
    setMirrorResult(null);
    try {
      const resp = await fetch('/api/mirror-media-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setMirrorError(
          `Mirror failed (${resp.status}): ${data.error ?? 'unknown'}`,
        );
        return;
      }
      setMirrorResult(data as MirrorBatchSummary);
    } catch (e) {
      setMirrorError(e instanceof Error ? e.message : String(e));
    } finally {
      setMirroring(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  return (
    <section className="space-y-6">
      <h2
        className="text-xl font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        Refresh Aggregate Analytics xlsx
      </h2>

      {/* Status banner */}
      <div
        className="p-4 rounded-lg border"
        style={{
          backgroundColor: isStale
            ? 'rgba(245, 158, 11, 0.08)'
            : 'var(--bg-card)',
          borderColor: isStale ? '#f59e0b' : 'var(--border)',
          color: isStale ? '#b45309' : 'var(--text-secondary)',
        }}
      >
        {xlsxLastDate === null ? (
          <p>No xlsx data has been imported yet.</p>
        ) : isStale ? (
          <p>
            <strong>Refresh recommended.</strong> Last xlsx data is from{' '}
            <code>{xlsxLastDate}</code> —{' '}
            <strong>{xlsxDaysOld} days old</strong>. Re-export from LinkedIn
            and upload below.
          </p>
        ) : (
          <p>
            ✓ Last xlsx data: <code>{xlsxLastDate}</code> ({xlsxDaysOld} days
            old). Refresh in {daysUntilStale} days.
          </p>
        )}
      </div>

      {/* Step-by-step instructions */}
      <details
        className="rounded-lg border"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border)',
        }}
      >
        <summary
          className="cursor-pointer px-4 py-3 text-sm font-medium select-none"
          style={{ color: 'var(--text-primary)' }}
        >
          How to export the xlsx (≈ 1 minute)
        </summary>
        <ol
          className="px-4 pb-4 text-sm space-y-2 list-decimal list-inside"
          style={{ color: 'var(--text-secondary)' }}
        >
          <li>
            Open{' '}
            <a
              href="https://www.linkedin.com/analytics/"
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              LinkedIn Analytics
            </a>{' '}
            in a new tab.
          </li>
          <li>
            Click <strong>Export</strong> in the top-right corner.
          </li>
          <li>
            Set <strong>Time range</strong> to <em>Past year</em> (or Custom
            with a long range — longer wins on ties).
          </li>
          <li>
            Format: <strong>XLSX</strong>. Click <strong>Export</strong>.
          </li>
          <li>
            LinkedIn downloads the file. Drag it into the area below, or
            click to choose.
          </li>
        </ol>
      </details>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="rounded-lg border-2 border-dashed p-8 text-center transition-colors"
        style={{
          backgroundColor: dragOver
            ? 'var(--accent-light)'
            : 'var(--bg-card)',
          borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <p
          className="mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {uploading ? 'Uploading…' : 'Drop your xlsx file here'}
        </p>
        <p
          className="text-xs mb-4"
          style={{ color: 'var(--text-muted)' }}
        >
          or click below to browse
        </p>
        <label className="inline-block cursor-pointer">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
          />
          <span
            className="px-4 py-2 rounded text-sm font-medium text-white transition-colors"
            style={{
              backgroundColor: 'var(--accent)',
            }}
          >
            Choose file
          </span>
        </label>
      </div>

      {/* Result panels */}
      {error && (
        <div
          className="p-4 rounded-lg border text-sm"
          style={{
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            color: '#b91c1c',
          }}
        >
          {error}
        </div>
      )}

      {summary && (
        <div
          className="p-4 rounded-lg border text-sm space-y-1"
          style={{
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            color: '#047857',
          }}
        >
          <p className="font-semibold">Import successful ✓</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>
              <strong>{summary.engagementRows.toLocaleString()}</strong> engagement
              rows upserted
            </li>
            <li>
              <strong>{summary.followerRows.toLocaleString()}</strong> follower
              snapshots upserted (anchor {summary.followerAnchorDate} ={' '}
              {summary.followerAnchorTotal.toLocaleString()})
            </li>
            <li>
              <strong>{summary.demographicRows.toLocaleString()}</strong> demographic
              rows upserted
            </li>
          </ul>
          <p
            className="text-xs mt-2"
            style={{ color: '#047857', opacity: 0.85 }}
          >
            Refresh this page to see the updated freshness above.
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* Mirror to Vercel Blob                                        */}
      {/* ----------------------------------------------------------- */}
      <div className="pt-4">
        <h2
          className="text-xl font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Mirror media to Vercel Blob
        </h2>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          LinkedIn CDN URLs include short-lived tokens that expire after
          ~30 days. Mirroring copies each URL into Vercel Blob so the
          dashboard can keep rendering post media long after LinkedIn&apos;s
          tokens go stale.
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div
            className="rounded-lg p-3 border text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {mediaStats.totalRows.toLocaleString()}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              total rows · {mediaStats.postsWithMedia} posts
            </div>
          </div>
          <div
            className="rounded-lg p-3 border text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="text-2xl font-bold"
              style={{ color: '#059669' }}
            >
              {mediaStats.mirrored.toLocaleString()}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              mirrored to Blob
            </div>
          </div>
          <div
            className="rounded-lg p-3 border text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="text-2xl font-bold"
              style={{
                color:
                  mediaStats.unmirrored > 0
                    ? '#b45309'
                    : 'var(--text-secondary)',
              }}
            >
              {mediaStats.unmirrored.toLocaleString()}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              still pending
            </div>
          </div>
        </div>

        <button
          onClick={runMirror}
          disabled={mirroring || mediaStats.unmirrored === 0}
          className="px-4 py-2 rounded text-sm font-medium text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {mirroring
            ? 'Mirroring…'
            : mediaStats.unmirrored === 0
              ? 'All caught up ✓'
              : `Mirror ${Math.min(mediaStats.unmirrored, 100)} pending`}
        </button>
        <p
          className="text-xs mt-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Processes up to 100 rows per click at 4 mirrors/sec (~25s).
          {mediaStats.unmirrored > 100 &&
            ` Click again afterwards to continue.`}
        </p>

        {mirrorError && (
          <div
            className="p-4 mt-3 rounded-lg border text-sm"
            style={{
              borderColor: '#dc2626',
              backgroundColor: 'rgba(220, 38, 38, 0.08)',
              color: '#b91c1c',
            }}
          >
            {mirrorError}
          </div>
        )}

        {mirrorResult && (
          <div
            className="p-4 mt-3 rounded-lg border text-sm space-y-1"
            style={{
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              color: '#047857',
            }}
          >
            <p className="font-semibold">Mirror batch finished ✓</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>
                <strong>{mirrorResult.mirrored}</strong> mirrored
              </li>
              {mirrorResult.alreadyMirrored > 0 && (
                <li>
                  <strong>{mirrorResult.alreadyMirrored}</strong> already
                  mirrored (skipped)
                </li>
              )}
              {mirrorResult.failed > 0 && (
                <li>
                  <strong>{mirrorResult.failed}</strong> failed (likely
                  expired CDN URLs)
                </li>
              )}
              <li>
                <strong>{mirrorResult.remaining}</strong> still pending
              </li>
            </ul>
            {mirrorResult.failures.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs underline">
                  Show {mirrorResult.failures.length} failure
                  {mirrorResult.failures.length === 1 ? '' : 's'}
                </summary>
                <ul className="text-xs mt-1 space-y-0.5 font-mono">
                  {mirrorResult.failures.map((f, i) => (
                    <li key={i}>
                      {f.activityId}: {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p
              className="text-xs mt-2"
              style={{ color: '#047857', opacity: 0.85 }}
            >
              Refresh this page to update the counts above.
            </p>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- */}
      {/* Complete LinkedIn data export (zip)                         */}
      {/* ----------------------------------------------------------- */}
      <div className="pt-4">
        <h2
          className="text-xl font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Refresh Complete LinkedIn Export (zip)
        </h2>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          The full LinkedIn data export (Settings → Data Privacy → Get a copy
          of your data). Powers the Engagement Habits page (your comments
          and reactions on others) and the Network page (full connections
          list).
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div
            className="rounded-lg p-3 border text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {exportStats.comments.toLocaleString()}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              comments
            </div>
          </div>
          <div
            className="rounded-lg p-3 border text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {exportStats.reactions.toLocaleString()}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              reactions
            </div>
          </div>
          <div
            className="rounded-lg p-3 border text-center"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {exportStats.connections.toLocaleString()}
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              connections
            </div>
          </div>
        </div>

        <div
          className="p-4 mb-4 rounded-lg border text-sm"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {exportStats.lastDate === null ? (
            <p>No engagement data imported yet.</p>
          ) : (
            <p>
              Latest engagement: <code>{exportStats.lastDate}</code>{' '}
              {exportStats.daysOld !== null && (
                <>({exportStats.daysOld} days ago)</>
              )}.
            </p>
          )}
        </div>

        {/* Step-by-step instructions */}
        <details
          className="rounded-lg border mb-4"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          <summary
            className="cursor-pointer px-4 py-3 text-sm font-medium select-none"
            style={{ color: 'var(--text-primary)' }}
          >
            How to request the zip (≈ 10 minutes for the subset)
          </summary>
          <ol
            className="px-4 pb-4 text-sm space-y-2 list-decimal list-inside"
            style={{ color: 'var(--text-secondary)' }}
          >
            <li>
              Open{' '}
              <a
                href="https://www.linkedin.com/mypreferences/d/download-my-data"
                target="_blank"
                rel="noreferrer"
                className="underline"
                style={{ color: 'var(--accent)' }}
              >
                LinkedIn data privacy
              </a>{' '}
              in a new tab.
            </li>
            <li>
              Choose <strong>Want something in particular?</strong> →
              select <strong>Connections, Comments, Reactions</strong>.
              (Adding all of them gets the data this page uses.)
            </li>
            <li>
              Click <strong>Request archive</strong>. LinkedIn emails the
              zip in a few minutes for the subset (24h for the full export).
            </li>
            <li>
              When the email arrives, download the zip — keep it as a zip,
              don&apos;t unzip.
            </li>
            <li>
              Drag it onto the area below.
            </li>
          </ol>
        </details>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setZipDragOver(true);
          }}
          onDragLeave={() => setZipDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setZipDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void uploadZip(f);
          }}
          className="rounded-lg border-2 border-dashed p-8 text-center transition-colors"
          style={{
            backgroundColor: zipDragOver
              ? 'var(--accent-light)'
              : 'var(--bg-card)',
            borderColor: zipDragOver ? 'var(--accent)' : 'var(--border)',
          }}
        >
          <p style={{ color: 'var(--text-primary)' }} className="mb-2">
            {zipUploading ? 'Importing…' : 'Drop your LinkedIn zip here'}
          </p>
          <p
            className="text-xs mb-4"
            style={{ color: 'var(--text-muted)' }}
          >
            or click below to browse
          </p>
          <label className="inline-block cursor-pointer">
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              disabled={zipUploading}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadZip(f);
              }}
            />
            <span
              className="px-4 py-2 rounded text-sm font-medium text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Choose file
            </span>
          </label>
        </div>

        {zipError && (
          <div
            className="p-4 mt-3 rounded-lg border text-sm"
            style={{
              borderColor: '#dc2626',
              backgroundColor: 'rgba(220, 38, 38, 0.08)',
              color: '#b91c1c',
            }}
          >
            {zipError}
          </div>
        )}

        {zipResult && (
          <div
            className="p-4 mt-3 rounded-lg border text-sm space-y-1"
            style={{
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              color: '#047857',
            }}
          >
            <p className="font-semibold">Import successful ✓</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>
                <strong>{zipResult.comments.toLocaleString()}</strong> comments
                upserted
              </li>
              <li>
                <strong>{zipResult.reactions.toLocaleString()}</strong> reactions
                upserted
              </li>
              <li>
                <strong>{zipResult.connections.toLocaleString()}</strong> connections
                upserted
              </li>
            </ul>
            {zipResult.filesFound.length > 0 && (
              <p className="text-xs mt-2 opacity-85">
                Files imported: {zipResult.filesFound.join(', ')}
              </p>
            )}
            <p
              className="text-xs mt-2"
              style={{ color: '#047857', opacity: 0.85 }}
            >
              Refresh this page to update the counts above.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
