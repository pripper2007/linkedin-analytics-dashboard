// Options page — lets Pedro configure the ingest URL + secret and trigger
// an on-demand run. Reads/writes chrome.storage.sync (for settings) and
// messages the background worker for "Ingest now" + status.

import type { WorkerMessage, WorkerStatus } from './types';

const $url = document.getElementById('url') as HTMLInputElement;
const $secret = document.getElementById('secret') as HTMLInputElement;
const $profileUrl = document.getElementById('profileUrl') as HTMLInputElement;
const $enabled = document.getElementById('enabled') as HTMLInputElement;
const $save = document.getElementById('save') as HTMLButtonElement;
const $ingest = document.getElementById('ingest') as HTMLButtonElement;
const $backfill = document.getElementById('backfill') as HTMLButtonElement;
const $resolveIds = document.getElementById('resolveIds') as HTMLButtonElement | null;
const $stopResolver = document.getElementById('stopResolver') as HTMLButtonElement | null;
const $stopBackfill = document.getElementById('stopBackfill') as HTMLButtonElement | null;
const $status = document.getElementById('status') as HTMLDivElement;

let autoRefreshHandle: number | null = null;

async function loadSettings(): Promise<void> {
  const r = await chrome.storage.sync.get([
    'ingestUrl',
    'ingestSecret',
    'profileUrl',
    'enabled',
  ]);
  $url.value = (r.ingestUrl as string) ?? '';
  $secret.value = (r.ingestSecret as string) ?? '';
  $profileUrl.value = (r.profileUrl as string) ?? '';
  $enabled.checked = r.enabled !== false; // default true
}

async function saveSettings(): Promise<void> {
  await chrome.storage.sync.set({
    ingestUrl: $url.value.trim(),
    ingestSecret: $secret.value.trim(),
    profileUrl: $profileUrl.value.trim(),
    enabled: $enabled.checked,
  });
  await refreshStatus('Settings saved.');
}

async function triggerIngest(): Promise<void> {
  $ingest.disabled = true;
  $status.textContent = 'Running ingest…';
  try {
    const msg: WorkerMessage = { type: 'ingest-now' };
    const res = await chrome.runtime.sendMessage(msg);
    if (res?.ok) {
      await refreshStatus(
        res.summary?.posts != null
          ? `Sent ${res.summary.posts} posts.`
          : `Skipped: ${res.summary?.skipped ?? 'unknown reason'}.`,
      );
    } else {
      await refreshStatus(`Failed: ${res?.error ?? 'unknown error'}`);
    }
  } catch (err) {
    await refreshStatus(
      `Failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    $ingest.disabled = false;
  }
}

function formatStatus(s: WorkerStatus, lead?: string): string {
  const lines: string[] = [];
  if (lead) lines.push(lead, '');
  lines.push(
    `Configured:        ${s.configured ? 'yes' : 'no (set URL + secret)'}`,
  );
  lines.push(`Buffered posts:    ${s.bufferedPosts}`);
  lines.push(`Buffered analytics:${s.bufferedPostAnalytics}`);
  const p = s.bufferedProfile;
  const profileParts: string[] = [];
  if (p?.totalFollowers !== undefined) profileParts.push(`followers=${p.totalFollowers}`);
  if (p?.totalConnections !== undefined) profileParts.push(`connections=${p.totalConnections}`);
  lines.push(
    `Buffered profile:  ${profileParts.length ? profileParts.join(', ') : '—'}`,
  );
  lines.push(`Last ingest at:    ${s.lastIngestAt ?? '—'}`);
  lines.push(`Last ingest:       ${s.lastIngestResult ?? '—'}`);
  if (s.lastIngestError) {
    lines.push(`Last error:        ${s.lastIngestError}`);
  }
  lines.push(`Follower fetch:    ${s.lastFollowerFetch ?? '—'}`);
  lines.push(`Connections fetch: ${s.lastConnectionsFetch ?? '—'}`);
  lines.push(`Connections debug: ${s.lastConnectionsScrapeDebug ?? '—'}`);
  if (s.backfill) {
    const b = s.backfill;
    const curr = b.currentActivityId ? ` (@ ${b.currentActivityId})` : '';
    const line =
      b.status === 'running'
        ? `running ${b.completed}/${b.total}${curr}`
        : b.status === 'error'
          ? `error: ${b.error}`
          : `done ${b.completed}/${b.total}`;
    lines.push(`Backfill:          ${line}`);
  }
  if (s.idResolver) {
    const r = s.idResolver;
    const last = r.lastMapping
      ? ` (last: ${r.lastMapping.oldId}→${r.lastMapping.newId ?? 'null'})`
      : '';
    const line =
      r.status === 'running'
        ? `running ${r.completed}/${r.total} · resolved=${r.resolved} failed=${r.failed}${last}`
        : r.status === 'error'
          ? `error: ${r.error}`
          : `done · resolved=${r.resolved}/${r.total} failed=${r.failed}`;
    lines.push(`ID resolver:       ${line}`);
  }
  return lines.join('\n');
}

async function refreshStatus(lead?: string): Promise<void> {
  const msg: WorkerMessage = { type: 'get-status' };
  const status = (await chrome.runtime.sendMessage(msg)) as WorkerStatus;
  $status.textContent = formatStatus(status, lead);

  // Auto-refresh every 2s if a backfill OR id-resolver is running (so
  // progress ticks up live) — or just kicked one off but state hasn't
  // landed yet.
  const running =
    status.backfill?.status === 'running' ||
    status.idResolver?.status === 'running';
  if (running && autoRefreshHandle == null) {
    autoRefreshHandle = window.setInterval(() => {
      void refreshStatus();
    }, 2000);
  } else if (!running && autoRefreshHandle != null) {
    clearInterval(autoRefreshHandle);
    autoRefreshHandle = null;
  }
}

/**
 * Poll just after clicking "Backfill now" until the running state is
 * visible, then let the normal auto-refresh take over. Covers the
 * race where the initial writeStatus hasn't happened yet at the time
 * of the first refresh.
 */
function kickOffAutoRefresh(): void {
  if (autoRefreshHandle != null) return;
  autoRefreshHandle = window.setInterval(() => {
    void refreshStatus();
  }, 2000);
}

async function triggerBackfill(): Promise<void> {
  if (
    !confirm(
      'Run backfill now? The extension will open up to ~60 of your recent ' +
        'posts in hidden tabs, one every ~20 seconds, to scrape their ' +
        'analytics. Takes around 20–25 minutes. Leave Chrome running.',
    )
  ) {
    return;
  }
  $backfill.disabled = true;
  $status.textContent = 'Starting backfill…';
  try {
    const msg: WorkerMessage = { type: 'backfill-now' };
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) {
      $status.textContent = `Backfill failed to start: ${res?.error ?? 'unknown'}`;
    } else {
      await refreshStatus('Backfill started.');
      kickOffAutoRefresh();
    }
  } finally {
    $backfill.disabled = false;
  }
}

async function triggerResolveIds(): Promise<void> {
  if (!$resolveIds) return;
  if (
    !confirm(
      'Resolve legacy share/ugcPost IDs? The extension will open each ' +
        'legacy post URL in a hidden tab to extract its real activity ' +
        'URN. Takes ~15–20 minutes for the full set. Leave Chrome running.',
    )
  ) {
    return;
  }
  $resolveIds.disabled = true;
  $status.textContent = 'Starting ID resolver…';
  try {
    const msg: WorkerMessage = { type: 'resolve-ids-now' };
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) {
      $status.textContent = `ID resolver failed to start: ${res?.error ?? 'unknown'}`;
    } else {
      await refreshStatus('ID resolver started.');
      kickOffAutoRefresh();
    }
  } finally {
    $resolveIds.disabled = false;
  }
}

async function triggerStopResolver(): Promise<void> {
  if (!$stopResolver) return;
  $stopResolver.disabled = true;
  try {
    const msg: WorkerMessage = { type: 'stop-resolver' };
    await chrome.runtime.sendMessage(msg);
    await refreshStatus('Resolver stopped.');
  } finally {
    $stopResolver.disabled = false;
  }
}

$save.addEventListener('click', saveSettings);
$ingest.addEventListener('click', triggerIngest);
$backfill.addEventListener('click', triggerBackfill);
if ($resolveIds) $resolveIds.addEventListener('click', triggerResolveIds);
if ($stopResolver) $stopResolver.addEventListener('click', triggerStopResolver);

async function triggerStopBackfill(): Promise<void> {
  if (!$stopBackfill) return;
  $stopBackfill.disabled = true;
  try {
    const msg: WorkerMessage = { type: 'stop-backfill' };
    await chrome.runtime.sendMessage(msg);
    await refreshStatus('Backfill stopped.');
  } finally {
    $stopBackfill.disabled = false;
  }
}
if ($stopBackfill) $stopBackfill.addEventListener('click', triggerStopBackfill);

// Export parser misses — drains chrome.storage.local.parserMisses (collected
// by the content script when parsePostSummaryHtml fails to find impressions)
// into a downloadable JSON file. Lets us inspect failure shapes offline
// without you copying anything from DevTools.
const $exportMisses = document.getElementById('exportMisses') as HTMLButtonElement | null;
async function exportParserMisses(): Promise<void> {
  if (!$exportMisses) return;
  const stored = await chrome.storage.local.get(['parserMisses']);
  const misses = Array.isArray(stored.parserMisses) ? stored.parserMisses : [];
  if (misses.length === 0) {
    $status.textContent =
      'No parser misses recorded yet. Open an analytics page that previously failed and try again.';
    return;
  }
  const blob = new Blob([JSON.stringify(misses, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `parser-misses-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  $status.textContent = `Exported ${misses.length} parser miss report(s).`;
}
if ($exportMisses) $exportMisses.addEventListener('click', exportParserMisses);

const $exportDemoMisses = document.getElementById(
  'exportDemoMisses',
) as HTMLButtonElement | null;
async function exportDemoMisses(): Promise<void> {
  const stored = await chrome.storage.local.get(['demographicMisses']);
  const misses = Array.isArray(stored.demographicMisses)
    ? stored.demographicMisses
    : [];
  if (misses.length === 0) {
    $status.textContent =
      'No demographic misses recorded yet. Run a backfill or probe a post.';
    return;
  }
  const blob = new Blob([JSON.stringify(misses, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `demographic-misses-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  $status.textContent = `Exported ${misses.length} demographic miss report(s).`;
}
if ($exportDemoMisses)
  $exportDemoMisses.addEventListener('click', exportDemoMisses);

const $exportDemoDetailMisses = document.getElementById(
  'exportDemoDetailMisses',
) as HTMLButtonElement | null;
async function exportDemoDetailMisses(): Promise<void> {
  const stored = await chrome.storage.local.get(['demographicDetailMisses']);
  const misses = Array.isArray(stored.demographicDetailMisses)
    ? stored.demographicDetailMisses
    : [];
  if (misses.length === 0) {
    $status.textContent =
      'No detail-page misses recorded — parser found data on every fetched detail page.';
    return;
  }
  const blob = new Blob([JSON.stringify(misses, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `demographic-detail-misses-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  $status.textContent = `Exported ${misses.length} detail-page miss report(s).`;
}
if ($exportDemoDetailMisses)
  $exportDemoDetailMisses.addEventListener('click', exportDemoDetailMisses);

// ---------------------------------------------------------------------------
// Phase 3d.E debug instrumentation:
//   - Export tick log: per-backfill-attempt outcomes (captured / throttled /
//     timeout / no-hydration) with durations and parsed-field keys. Tells
//     us the actual mix of failure modes after a run.
//   - Export fingerprints: page-state snapshots from the silent-bail path
//     (title / URL / sample text). Reveals what LinkedIn served when the
//     page didn't hydrate.
//   - Probe activity ID: opens an analytics page in a foreground tab so
//     the user can see LinkedIn's response with their own eyes. Outcomes
//     land in the same buffers and are exportable above.
// ---------------------------------------------------------------------------
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const $exportTickLog = document.getElementById(
  'exportTickLog',
) as HTMLButtonElement | null;
async function exportTickLog(): Promise<void> {
  const stored = await chrome.storage.local.get(['backfill_tick_log_v1']);
  const log = Array.isArray(stored.backfill_tick_log_v1)
    ? stored.backfill_tick_log_v1
    : [];
  if (log.length === 0) {
    $status.textContent = 'No tick log entries yet. Run a backfill first.';
    return;
  }
  downloadJson(log, `tick-log-${new Date().toISOString().slice(0, 10)}.json`);
  $status.textContent = `Exported ${log.length} tick log entr${log.length === 1 ? 'y' : 'ies'}.`;
}
if ($exportTickLog) $exportTickLog.addEventListener('click', exportTickLog);

const $exportFingerprints = document.getElementById(
  'exportFingerprints',
) as HTMLButtonElement | null;
async function exportFingerprints(): Promise<void> {
  const stored = await chrome.storage.local.get(['page_fingerprints_v1']);
  const fps = Array.isArray(stored.page_fingerprints_v1)
    ? stored.page_fingerprints_v1
    : [];
  if (fps.length === 0) {
    $status.textContent =
      'No page fingerprints captured yet. Run a backfill or probe a post.';
    return;
  }
  downloadJson(fps, `fingerprints-${new Date().toISOString().slice(0, 10)}.json`);
  $status.textContent = `Exported ${fps.length} fingerprint${fps.length === 1 ? '' : 's'}.`;
}
if ($exportFingerprints)
  $exportFingerprints.addEventListener('click', exportFingerprints);

const $probePost = document.getElementById(
  'probePost',
) as HTMLButtonElement | null;
async function probePost(): Promise<void> {
  const raw = prompt(
    'Activity ID to probe (numeric, e.g. 7328166646710206464). ' +
      "Opens LinkedIn's analytics page for that post in a foreground tab so " +
      'you can see what they serve. Outcomes land in the tick log + ' +
      'fingerprint buffer.',
  );
  if (!raw) return;
  const activityId = raw.trim();
  if (!/^\d+$/.test(activityId)) {
    $status.textContent = `Invalid activity ID "${activityId}" — expected digits only.`;
    return;
  }
  const m: WorkerMessage = { type: 'probe-post', activityId };
  const res = await chrome.runtime.sendMessage(m);
  if (res?.ok) {
    $status.textContent = `Probe tab opened for ${activityId}. Watch the page; then click Export tick log / Export fingerprints.`;
  } else {
    $status.textContent = `Probe failed: ${res?.error ?? 'unknown error'}`;
  }
}
if ($probePost) $probePost.addEventListener('click', probePost);

loadSettings().then(() => refreshStatus());
