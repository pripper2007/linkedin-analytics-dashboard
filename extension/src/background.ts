// Background service worker.
//
// Responsibilities:
//   - Receive captured posts + profile fields from the content script,
//     maintain two buffers in chrome.storage.local:
//       * posts buffer: deduped by activityId (latest wins)
//       * profile buffer: single object, fields merged (latest wins per-field)
//   - On a daily chrome.alarms tick (or on manual "Ingest now"), POST both
//     buffers to /api/ingest and clear on success.
//   - Maintain a small status record so the options page can show health.
//
// MV3 service workers are ephemeral; all state lives in chrome.storage.

import type {
  BackfillState,
  ExtensionSettings,
  IdResolverState,
  PageFingerprint,
  ParsedPost,
  ParsedPostAnalytics,
  ParsedProfile,
  WorkerMessage,
  WorkerStatus,
} from './types';
import {
  parseFollowerCountFromHtml,
  sampleFollowerLabelContext,
} from './voyager-profile-parser';

const ALARM_NAME = 'la-daily-ingest';
const ID_RESOLVER_ALARM = 'la-id-resolver-tick';
const BACKFILL_ALARM = 'la-backfill-tick';
const POSTS_BUFFER_KEY = 'buffered_posts_v1';
const POST_ANALYTICS_BUFFER_KEY = 'buffered_post_analytics_v1';
const PROFILE_BUFFER_KEY = 'buffered_profile_v1';
const STATUS_KEY = 'status_v1';
const RESOLVED_IDS_KEY = 'resolved_activity_ids_v1';
// Diagnostic ring buffers (Phase 3d.E debug instrumentation).
// One row per backfill tick + one row per silent-bail page fingerprint.
const BACKFILL_TICK_LOG_KEY = 'backfill_tick_log_v1';
const PAGE_FINGERPRINT_BUFFER_KEY = 'page_fingerprints_v1';
const TICK_LOG_CAP = 200;
const FINGERPRINT_CAP = 100;

// ---------------------------------------------------------------------------
// Install / startup — schedule the daily alarm.
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  ensureDailyAlarm();
  void clearStaleStatus();
});
chrome.runtime.onStartup.addListener(() => {
  ensureDailyAlarm();
  void clearStaleStatus();
});

/**
 * Drop any lastConnectionsFetch value from a removed code path. During
 * development we tried a few proactive fetch strategies (service-worker,
 * isolated content script, MAIN world) before falling back to the
 * interceptor. Their 403 statuses linger in chrome.storage and would
 * confuse the options page until the next opportunistic capture.
 */
async function clearStaleStatus(): Promise<void> {
  const row = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] as
    | Partial<WorkerStatus>
    | undefined;
  if (!row) return;
  const v = row.lastConnectionsFetch;
  if (typeof v === 'string' && /\((MAIN|ambient)\)/.test(v)) {
    await writeStatus({ lastConnectionsFetch: null });
  }
}

function ensureDailyAlarm(): void {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (existing) return;
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 5,
      periodInMinutes: 60 * 24,
    });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ID_RESOLVER_ALARM) {
    await resolveOneTick().catch((err) => {
      console.error('[id-resolver tick]', err);
    });
    return;
  }
  if (alarm.name === BACKFILL_ALARM) {
    await backfillOneTick().catch((err) => {
      console.error('[backfill tick]', err);
    });
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  await runIngest().catch((err) => {
    console.error('[background] daily ingest failed:', err);
  });
});

// ---------------------------------------------------------------------------
// Message handling from content script + options page.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg: WorkerMessage, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'buffer-posts':
        await bufferPosts(msg.posts);
        sendResponse({ ok: true });
        break;
      case 'buffer-profile':
        await bufferProfile(msg.profile);
        // Surface opportunistic connections capture on the options page
        // so the user can see the interceptor caught LinkedIn's own call.
        if (msg.profile.totalConnections != null) {
          await writeStatus({
            lastConnectionsFetch:
              `ok: ${msg.profile.totalConnections} connections ` +
              `(via interceptor, ${new Date().toISOString()})`,
          });
        }
        sendResponse({ ok: true });
        break;
      case 'buffer-post-analytics':
        await bufferPostAnalytics(msg.analytics);
        sendResponse({ ok: true });
        break;
      case 'connections-scrape-debug':
        await writeStatus({ lastConnectionsScrapeDebug: msg.message });
        sendResponse({ ok: true });
        break;
      case 'buffer-page-fingerprint':
        await appendPageFingerprint(msg.fingerprint);
        sendResponse({ ok: true });
        break;
      case 'probe-post':
        // Open the analytics page in a foreground tab so the user can
        // visually inspect what LinkedIn serves. The content script
        // runs as normal — outcomes (capture, throttle marker, no-
        // hydration marker, fingerprint) land in the regular buffers
        // and are exportable via the popup. No orchestrator state
        // touched.
        try {
          await chrome.tabs.create({
            url: POST_SUMMARY_URL_TEMPLATE(msg.activityId),
            active: true,
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      case 'backfill-now':
        // Fire-and-forget — the run reports progress via writeStatus,
        // readable by the options page through get-status. We respond
        // immediately so the UI doesn't stall for the ~20-minute run.
        void startBackfillRun().catch((err) => {
          console.error('[background] backfill failed:', err);
          void writeStatus({
            backfill: {
              status: 'error',
              total: 0,
              completed: 0,
              currentActivityId: null,
              error: err instanceof Error ? err.message : String(err),
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              consecutiveNonCaptured: 0,
              visitedIds: [],
            },
          });
        });
        sendResponse({ ok: true });
        break;
      case 'stop-backfill': {
        await chrome.alarms.clear(BACKFILL_ALARM);
        const status = await readStatus();
        const prev = status.backfill;
        if (prev && prev.status === 'running') {
          await writeStatus({
            backfill: {
              ...prev,
              status: 'error',
              error: 'stopped by user',
              finishedAt: new Date().toISOString(),
              currentActivityId: null,
            },
          });
          await stripDiagnosticMarkers();
          await closeBackfillWindow(prev.windowId);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'stop-resolver': {
        await chrome.alarms.clear(ID_RESOLVER_ALARM);
        const status = await readStatus();
        const prev = status.idResolver;
        if (prev && prev.status === 'running') {
          await writeStatus({
            idResolver: {
              ...prev,
              status: 'done',
              error: 'stopped by user',
              finishedAt: new Date().toISOString(),
            },
          });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'resolve-ids-now':
        void runIdResolver().catch((err) => {
          console.error('[background] id-resolver failed:', err);
          void writeStatus({
            idResolver: {
              status: 'error',
              total: 0,
              completed: 0,
              resolved: 0,
              failed: 0,
              lastMapping: null,
              error: err instanceof Error ? err.message : String(err),
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
            },
          });
        });
        sendResponse({ ok: true });
        break;
      case 'resolved-activity-id': {
        // Content script on a /feed/update/urn:li:share:*/ or
        // urn:li:ugcPost:*/ page extracted (or failed to extract) the
        // real activity URN from the page. Store it in a keyed buffer;
        // the orchestrator polls this buffer to pair up each tab with
        // its resolution.
        const buf = await readResolvedBuffer();
        buf[msg.oldActivityId] = msg.newActivityId;
        await writeResolvedBuffer(buf);
        sendResponse({ ok: true });
        break;
      }
      case 'ingest-now':
        try {
          const summary = await runIngest();
          sendResponse({ ok: true, summary });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      case 'get-status':
        sendResponse(await readStatus());
        break;
    }
  })();
  return true; // keep channel open for async sendResponse
});

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function getSettings(): Promise<ExtensionSettings | null> {
  const r = await chrome.storage.sync.get([
    'ingestUrl',
    'ingestSecret',
    'profileUrl',
    'enabled',
  ]);
  if (!r.ingestUrl || !r.ingestSecret) return null;
  const profileUrl =
    typeof r.profileUrl === 'string' && r.profileUrl.trim()
      ? (r.profileUrl as string).trim()
      : undefined;
  return {
    ingestUrl: r.ingestUrl as string,
    ingestSecret: r.ingestSecret as string,
    enabled: r.enabled !== false,
    profileUrl,
  };
}

async function readPostsBuffer(): Promise<ParsedPost[]> {
  const r = await chrome.storage.local.get(POSTS_BUFFER_KEY);
  const arr = r[POSTS_BUFFER_KEY];
  return Array.isArray(arr) ? (arr as ParsedPost[]) : [];
}

async function writePostsBuffer(posts: ParsedPost[]): Promise<void> {
  await chrome.storage.local.set({ [POSTS_BUFFER_KEY]: posts });
}

async function readResolvedBuffer(): Promise<Record<string, string | null>> {
  const r = await chrome.storage.local.get(RESOLVED_IDS_KEY);
  const obj = r[RESOLVED_IDS_KEY];
  return obj && typeof obj === 'object'
    ? (obj as Record<string, string | null>)
    : {};
}

async function writeResolvedBuffer(
  buf: Record<string, string | null>,
): Promise<void> {
  await chrome.storage.local.set({ [RESOLVED_IDS_KEY]: buf });
}

async function readProfileBuffer(): Promise<ParsedProfile | null> {
  const r = await chrome.storage.local.get(PROFILE_BUFFER_KEY);
  const obj = r[PROFILE_BUFFER_KEY];
  return obj && typeof obj === 'object' ? (obj as ParsedProfile) : null;
}

async function writeProfileBuffer(profile: ParsedProfile | null): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_BUFFER_KEY]: profile });
}

async function bufferPosts(incoming: ParsedPost[]): Promise<void> {
  const existing = await readPostsBuffer();
  const byId = new Map<string, ParsedPost>();
  for (const p of existing) byId.set(p.activityId, p);
  for (const p of incoming) byId.set(p.activityId, p);
  await writePostsBuffer([...byId.values()]);
}

async function readPostAnalyticsBuffer(): Promise<ParsedPostAnalytics[]> {
  const r = await chrome.storage.local.get(POST_ANALYTICS_BUFFER_KEY);
  const arr = r[POST_ANALYTICS_BUFFER_KEY];
  return Array.isArray(arr) ? (arr as ParsedPostAnalytics[]) : [];
}

async function writePostAnalyticsBuffer(
  items: ParsedPostAnalytics[],
): Promise<void> {
  await chrome.storage.local.set({ [POST_ANALYTICS_BUFFER_KEY]: items });
}

/**
 * Merge a fresh post-analytics capture into the buffer. Keyed by
 * activityId: the latest capture overwrites the previous one for that
 * post (newer DOM = better data).
 */
async function bufferPostAnalytics(
  incoming: ParsedPostAnalytics,
): Promise<void> {
  const existing = await readPostAnalyticsBuffer();
  const byId = new Map<string, ParsedPostAnalytics>();
  for (const a of existing) byId.set(a.activityId, a);
  byId.set(incoming.activityId, incoming);
  await writePostAnalyticsBuffer([...byId.values()]);
}

/**
 * Remove any analytics-buffer entry for this activityId. Called by
 * the orchestrator before opening a capture tab so bufferLookup can't
 * latch onto a stale entry from a previous tick. (Without this, the
 * orchestrator's polling loop returned 'captured' in <100ms because
 * the previous tick's entry was still keyed by the same activityId.)
 */
async function clearBufferEntry(activityId: string): Promise<void> {
  const buf = await readPostAnalyticsBuffer();
  const filtered = buf.filter((a) => a.activityId !== activityId);
  if (filtered.length !== buf.length) {
    await writePostAnalyticsBuffer(filtered);
  }
}

/**
 * Diagnostic ring buffers — one tick-log entry per backfill capture
 * attempt, one fingerprint per silent-bail. Both capped so chrome.
 * storage.local doesn't grow unbounded across many runs.
 */
interface TickLogEntry {
  capturedAt: string;
  activityId: string;
  outcome: 'captured' | 'throttled' | 'timeout' | 'no-hydration';
  durationMs: number;
  /** Fields the parser populated, e.g. ['impressions', 'reactions']. */
  parsedFieldKeys?: string[];
}

async function appendTickLog(entry: TickLogEntry): Promise<void> {
  const r = await chrome.storage.local.get(BACKFILL_TICK_LOG_KEY);
  const arr = Array.isArray(r[BACKFILL_TICK_LOG_KEY])
    ? (r[BACKFILL_TICK_LOG_KEY] as TickLogEntry[])
    : [];
  arr.push(entry);
  await chrome.storage.local.set({
    [BACKFILL_TICK_LOG_KEY]: arr.slice(-TICK_LOG_CAP),
  });
}

async function appendPageFingerprint(fp: PageFingerprint): Promise<void> {
  const r = await chrome.storage.local.get(PAGE_FINGERPRINT_BUFFER_KEY);
  const arr = Array.isArray(r[PAGE_FINGERPRINT_BUFFER_KEY])
    ? (r[PAGE_FINGERPRINT_BUFFER_KEY] as PageFingerprint[])
    : [];
  arr.push(fp);
  await chrome.storage.local.set({
    [PAGE_FINGERPRINT_BUFFER_KEY]: arr.slice(-FINGERPRINT_CAP),
  });
}

/**
 * Merge fresh profile fields into the buffered profile. Each field is
 * written independently — captures from different endpoints accumulate,
 * and each subsequent capture overrides the previous value for that field.
 */
async function bufferProfile(incoming: ParsedProfile): Promise<void> {
  const existing = (await readProfileBuffer()) ?? {};
  await writeProfileBuffer({ ...existing, ...incoming });
}

async function readStatus(): Promise<WorkerStatus> {
  const [settingsRow, postsRow, analyticsRow, profileRow, statusRow] =
    await Promise.all([
      chrome.storage.sync.get(['ingestUrl', 'ingestSecret']),
      chrome.storage.local.get(POSTS_BUFFER_KEY),
      chrome.storage.local.get(POST_ANALYTICS_BUFFER_KEY),
      chrome.storage.local.get(PROFILE_BUFFER_KEY),
      chrome.storage.local.get(STATUS_KEY),
    ]);
  const buffered = Array.isArray(postsRow[POSTS_BUFFER_KEY])
    ? (postsRow[POSTS_BUFFER_KEY] as unknown[]).length
    : 0;
  const bufferedAnalytics = Array.isArray(
    analyticsRow[POST_ANALYTICS_BUFFER_KEY],
  )
    ? (analyticsRow[POST_ANALYTICS_BUFFER_KEY] as unknown[]).length
    : 0;
  const profile =
    profileRow[PROFILE_BUFFER_KEY] &&
    typeof profileRow[PROFILE_BUFFER_KEY] === 'object'
      ? (profileRow[PROFILE_BUFFER_KEY] as ParsedProfile)
      : null;
  const saved = statusRow[STATUS_KEY] as Partial<WorkerStatus> | undefined;
  return {
    lastIngestAt: saved?.lastIngestAt ?? null,
    lastIngestResult: saved?.lastIngestResult ?? null,
    lastIngestError: saved?.lastIngestError ?? null,
    lastFollowerFetch: saved?.lastFollowerFetch ?? null,
    lastConnectionsFetch: saved?.lastConnectionsFetch ?? null,
    lastConnectionsScrapeDebug: saved?.lastConnectionsScrapeDebug ?? null,
    bufferedPosts: buffered,
    bufferedPostAnalytics: bufferedAnalytics,
    bufferedProfile: profile,
    configured: Boolean(settingsRow.ingestUrl && settingsRow.ingestSecret),
    backfill: saved?.backfill ?? null,
    idResolver: saved?.idResolver ?? null,
  };
}

async function writeStatus(patch: Partial<WorkerStatus>): Promise<void> {
  const existing =
    (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] ?? {};
  await chrome.storage.local.set({
    [STATUS_KEY]: { ...existing, ...patch },
  });
}

// ---------------------------------------------------------------------------
// Background follower-count fetch
//
// LinkedIn stopped returning the signed-in user's follower count in any
// Voyager JSON endpoint as of 2026-04 — it's only rendered into the
// server-side HTML of /in/<vanity>/ via RSC. So on every ingest we fetch
// the profile page directly (cookies ride along because the extension has
// host_permissions for linkedin.com) and regex the number out of the HTML.
//
// Any failure here — no profileUrl, HTTP error, unmatched regex — is
// swallowed silently. The ingest proceeds without a fresh follower value;
// whatever was previously buffered (or nothing) gets POSTed.
// ---------------------------------------------------------------------------
interface FollowerFetchOutcome {
  status: string;
  count?: number;
}

async function fetchFollowerCount(
  profileUrl: string,
): Promise<FollowerFetchOutcome> {
  let resp: Response;
  try {
    resp = await fetch(profileUrl, {
      credentials: 'include',
      redirect: 'follow',
    });
  } catch (err) {
    return {
      status: `fetch threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!resp.ok) {
    return { status: `HTTP ${resp.status} from ${resp.url}` };
  }
  const html = await resp.text();
  const count = parseFollowerCountFromHtml(html);
  if (count != null) return { status: `ok: ${count} followers`, count };

  // Regex miss — assemble a diagnostic bundle so we can see what LinkedIn
  // actually served (login wall? app-shell? completely different page?).
  const finalUrl = resp.url;
  const redirected = finalUrl !== profileUrl ? ` → ${finalUrl}` : '';
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 80) : '(no title)';
  const hasLinkedInText = /linkedin/i.test(html);
  const looksLikeAuthwall = /authwall|uas\/login|\/login\?/i.test(html);
  const looksLikeAppShell =
    html.length < 200_000 || !/<main\b|<section\b|<article\b/i.test(html);
  const context = sampleFollowerLabelContext(html);
  const bits = [
    `no label match`,
    `bytes=${html.length}`,
    `title="${title}"`,
    `liText=${hasLinkedInText}`,
    `authwall=${looksLikeAuthwall}`,
    `appShell=${looksLikeAppShell}`,
  ];
  if (redirected) bits.push(`redirect${redirected}`);
  if (context) bits.push(`ctx="${context}"`);
  return { status: bits.join(' | ') };
}

async function captureFollowersIfConfigured(
  settings: ExtensionSettings,
): Promise<string> {
  if (!settings.profileUrl) return 'skipped: no profileUrl configured';
  const outcome = await fetchFollowerCount(settings.profileUrl);
  if (outcome.count != null) {
    await bufferProfile({ totalFollowers: outcome.count });
  }
  // eslint-disable-next-line no-console
  console.log('[background] follower-fetch:', outcome.status);
  return outcome.status;
}

// Connections capture — "open /mynetwork, let LinkedIn call its own
// API" pattern. Every proactive fetch variant we tried previously got
// a 403 from Voyager's connectionsSummary endpoint (service worker,
// isolated content script, MAIN-world same-origin — all rejected
// despite valid JSESSIONID + csrf-token + restli headers). LinkedIn
// validates additional fingerprint/context beyond standard headers.
//
// Workaround: open /mynetwork/grow/ in a background tab. LinkedIn's
// own page JS calls connectionsSummary during load (same origin, full
// session context, valid referrer chain) — which the MAIN-world
// interceptor catches naturally. Tab closes after 25s. Gated on a
// 22h freshness window so we don't do this on every ingest.

// "Your connections" list page. This is the /mynetwork/ sub-route that
// renders the total-count header at the top — LinkedIn's own JS has
// to call connectionsSummary on load to produce it, so our interceptor
// catches the response. /mynetwork/grow/ (the recommendation hub) was
// tried first but didn't reliably fire the endpoint.
const MY_NETWORK_URL =
  'https://www.linkedin.com/mynetwork/invite-connect/connections/';
// Generous ceiling — LinkedIn sometimes delays the call behind other
// tracking/bootstrap requests, especially on a background tab with
// throttled rendering.
const CONNECTIONS_CAPTURE_TIMEOUT_MS = 40_000;
const CONNECTIONS_CAPTURE_POLL_MS = 1_000;
// Connections change slowly — daily refresh is plenty; 22h (slightly
// under a day) avoids the "it's been exactly 24h" edge where a daily
// alarm would skip the capture every other run.
const CONNECTIONS_CAPTURE_FRESH_MS = 22 * 3_600_000;

/** Extracts the ISO timestamp from a status.lastConnectionsFetch label. */
function extractTimestampFromFetchLabel(s: string | null): Date | null {
  if (!s) return null;
  const m = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(s);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d;
}

async function captureConnectionsIfDue(): Promise<string | null> {
  const status = await readStatus();
  const lastSuccess = extractTimestampFromFetchLabel(status.lastConnectionsFetch);
  const isStale =
    !lastSuccess ||
    Date.now() - lastSuccess.getTime() >= CONNECTIONS_CAPTURE_FRESH_MS;
  if (!isStale) return null; // fresh enough — skip the tab roundtrip

  // Background-tab approach timed out twice (even with a 40s budget) —
  // Chrome throttles JS timers + rAF in background tabs, and LinkedIn's
  // /mynetwork/invite-connect/connections page evidently gates the
  // connectionsSummary call behind visibility. We open the tab with
  // `active: true` so its JS runs at full speed, remember the
  // previously active tab, and restore focus as soon as the buffer
  // picks up the count (or after timeout).
  let tabId: number | undefined;
  let previouslyActiveTabId: number | undefined;
  try {
    // Remember which tab was active in the current window so we can
    // restore focus after the capture completes.
    const [activeBefore] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    previouslyActiveTabId = activeBefore?.id;

    const tab = await chrome.tabs.create({
      url: MY_NETWORK_URL,
      active: true,
    });
    tabId = tab.id;
    const started = Date.now();
    while (Date.now() - started < CONNECTIONS_CAPTURE_TIMEOUT_MS) {
      const buf = await readProfileBuffer();
      if (buf?.totalConnections != null) {
        // Success — the buffer-profile handler already wrote the
        // lastConnectionsFetch label when the intercepted response
        // arrived. Nothing else to record here.
        return `ok: ${buf.totalConnections} connections (my-network tab)`;
      }
      await sleep(CONNECTIONS_CAPTURE_POLL_MS);
    }
    // Timed out — possibilities: user not signed in (page redirected
    // to auth), LinkedIn changed its page-load sequence, or the
    // endpoint was cached/skipped. No retry spam; next ingest tries
    // again once the 22h window expires.
    const fallback = `timeout: no connectionsSummary within ${CONNECTIONS_CAPTURE_TIMEOUT_MS / 1000}s`;
    await writeStatus({ lastConnectionsFetch: fallback });
    return fallback;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fallback = `error: ${msg}`;
    await writeStatus({ lastConnectionsFetch: fallback });
    return fallback;
  } finally {
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Tab may have closed itself during navigation. Ignore.
      }
    }
    // Restore the user's original tab focus if we captured one.
    if (previouslyActiveTabId != null) {
      try {
        await chrome.tabs.update(previouslyActiveTabId, { active: true });
      } catch {
        // Original tab may have been closed meanwhile. Ignore.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The ingest flow
// ---------------------------------------------------------------------------
interface IngestSummary {
  posts?: number;
  profile?: 'included' | 'skipped';
  skipped?: string;
}

async function runIngest(): Promise<IngestSummary> {
  const settings = await getSettings();
  if (!settings) {
    const reason = 'not configured — open the options page first';
    await writeStatus({
      lastIngestAt: new Date().toISOString(),
      lastIngestResult: 'failure',
      lastIngestError: reason,
    });
    return { skipped: reason };
  }
  if (!settings.enabled) return { skipped: 'disabled' };

  // Freshly capture the follower count AND (if stale) connections count
  // BEFORE reading the buffer, so the latest values ride along in this
  // POST. captureConnectionsIfDue is a no-op when our last successful
  // reading is <22h old — keeps the tab-opening side-effect rare.
  const followerFetchStatus = await captureFollowersIfConfigured(settings);
  await writeStatus({ lastFollowerFetch: followerFetchStatus });
  await captureConnectionsIfDue();

  const [postsBuffer, analyticsBuffer, profileBuffer] = await Promise.all([
    readPostsBuffer(),
    readPostAnalyticsBuffer(),
    readProfileBuffer(),
  ]);

  const hasPosts = postsBuffer.length > 0;
  const hasAnalytics = analyticsBuffer.length > 0;
  const hasProfile = profileBuffer !== null &&
    (profileBuffer.totalFollowers !== undefined ||
      profileBuffer.totalConnections !== undefined);

  if (!hasPosts && !hasAnalytics && !hasProfile) {
    return { skipped: 'buffer empty — nothing to ingest' };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Merge feed-captured posts with post-summary analytics by activityId,
  // so a post that has both gets ONE outgoing entry (server upserts once).
  // Feed fields are authoritative for reactionsTotal/comments/reposts;
  // analytics fields fill in saves/sends/followersGained/profile viewers/
  // video metrics.
  const mergedByActivityId = new Map<string, Record<string, unknown>>();

  for (const p of postsBuffer) {
    mergedByActivityId.set(p.activityId, {
      activityId: p.activityId,
      postContent: p.postContent,
      postUrl: p.postUrl,
      postedAt: p.postedAt,
      snapshotDate: today,
      impressions: p.impressions,
      reactionsTotal: p.reactionsTotal,
      reactionsLike: p.reactionsLike,
      reactionsCelebrate: p.reactionsCelebrate,
      reactionsSupport: p.reactionsSupport,
      reactionsLove: p.reactionsLove,
      reactionsInsightful: p.reactionsInsightful,
      reactionsFunny: p.reactionsFunny,
      comments: p.comments,
      reposts: p.reposts,
      // Media URLs (images/videos) extracted by the feed-page interceptor.
      // Previously dropped here, leaving post_media empty in the DB.
      media: p.media,
    });
  }

  for (const a of analyticsBuffer) {
    const existing = mergedByActivityId.get(a.activityId) ?? {
      activityId: a.activityId,
      snapshotDate: today,
    };
    // Only copy defined fields; let feed fields stand where both have it.
    if (a.impressions !== undefined && existing.impressions === undefined) {
      existing.impressions = a.impressions;
    }
    if (a.membersReached !== undefined) existing.membersReached = a.membersReached;
    // reactions-from-analytics is the TOTAL count (same as feed).
    // If the feed has it, keep feed; otherwise use analytics.
    if (a.reactions !== undefined && existing.reactionsTotal === undefined) {
      existing.reactionsTotal = a.reactions;
    }
    if (a.comments !== undefined && existing.comments === undefined) {
      existing.comments = a.comments;
    }
    if (a.reposts !== undefined && existing.reposts === undefined) {
      existing.reposts = a.reposts;
    }
    if (a.saves !== undefined) existing.saves = a.saves;
    if (a.sends !== undefined) existing.sends = a.sends;
    if (a.profileViewers !== undefined) existing.profileViewers = a.profileViewers;
    if (a.followersGained !== undefined) existing.followersGained = a.followersGained;
    if (a.linkEngagements !== undefined) existing.linkClicks = a.linkEngagements;
    if (a.videoViews !== undefined) existing.videoViews = a.videoViews;
    if (a.watchTimeSeconds !== undefined) existing.watchTimeSeconds = a.watchTimeSeconds;
    if (a.averageWatchTimeSeconds !== undefined) {
      existing.averageWatchTimeSeconds = a.averageWatchTimeSeconds;
    }
    // Per-post demographics extracted by the post-summary parser.
    // Previously the parser didn't even read the demographics block;
    // now it does, so we forward the entries to the server which
    // upserts them into post_demographics.
    if (a.demographics && a.demographics.length > 0) {
      existing.demographics = a.demographics;
    }
    mergedByActivityId.set(a.activityId, existing);
  }

  const payload: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    source: 'extension-v1',
    posts: [...mergedByActivityId.values()],
  };

  if (hasProfile && profileBuffer) {
    payload.profile = {
      snapshotDate: today,
      totalFollowers: profileBuffer.totalFollowers,
      totalConnections: profileBuffer.totalConnections,
    };
  }

  const response = await fetch(settings.ingestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': settings.ingestSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const msg = `HTTP ${response.status}: ${text.slice(0, 300)}`;
    await writeStatus({
      lastIngestAt: new Date().toISOString(),
      lastIngestResult: 'failure',
      lastIngestError: msg,
    });
    throw new Error(msg);
  }

  // Success — clear all three buffers.
  await Promise.all([
    writePostsBuffer([]),
    writePostAnalyticsBuffer([]),
    writeProfileBuffer(null),
  ]);
  await writeStatus({
    lastIngestAt: new Date().toISOString(),
    lastIngestResult: 'success',
    lastIngestError: null,
  });
  return {
    posts: mergedByActivityId.size,
    profile: hasProfile ? 'included' : 'skipped',
  };
}

// ---------------------------------------------------------------------------
// Phase 3d.C-core — post-summary orchestrator
//
// Given a list of activity IDs, open each post's analytics page in a
// hidden tab, wait for the content-script capture to land in the
// analytics buffer, then close the tab. Rate-limited between tabs so
// LinkedIn can't infer an automation pattern from the request cadence.
//
// Exposed via:
//   - `startBackfillRun()` — pulls the activity-id list from the
//     server's /api/posts-needing-capture endpoint and runs. Called
//     from the options page's "Backfill now" button (Phase 3d.D).
//   - Future: same function wired into the chrome.alarms daily tick
//     with a different activity-id source (Phase 3d.C-forward).
//
// Requires the "tabs" permission.
// ---------------------------------------------------------------------------

const POST_SUMMARY_URL_TEMPLATE = (id: string) =>
  `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${id}/`;
const ORCH_PER_POST_TIMEOUT_MS = 45_000;
const ORCH_BUFFER_POLL_MS = 1_000;
// Rate-limit between posts uses a randomized jitter window instead of
// a fixed cadence — a metronome-perfect 30s gap between tab opens is
// exactly the kind of pattern anti-bot heuristics look for. 45-90s
// random keeps the average in a human-plausible range while breaking
// up the signature. Avg 67.5s, so a 10-post run takes ~11 min.
const ORCH_RATE_LIMIT_MIN_MS = 45_000;
const ORCH_RATE_LIMIT_MAX_MS = 90_000;
// Abort the run after this many consecutive non-captured outcomes
// (any of throttled / timeout / no-hydration). 3 leaves a small
// margin for one transient failure but still bounds wasted time on
// a sustained-block run to ~5 minutes.
const ORCH_MAX_CONSECUTIVE_NON_CAPTURED = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface BufferLookup {
  present: boolean;
  throttled: boolean;
  noHydration: boolean;
  /** When present and not a marker, the entry's parsed fields. */
  parsedFieldKeys?: string[];
}

async function bufferLookup(activityId: string): Promise<BufferLookup> {
  const buf = await readPostAnalyticsBuffer();
  const entry = buf.find((a) => a.activityId === activityId);
  if (!entry) return { present: false, throttled: false, noHydration: false };
  const isMarker =
    entry.throttled === true || (entry as { noHydration?: true }).noHydration === true;
  return {
    present: true,
    throttled: entry.throttled === true,
    noHydration: (entry as { noHydration?: true }).noHydration === true,
    parsedFieldKeys: isMarker
      ? undefined
      : Object.keys(entry).filter(
          (k) =>
            k !== 'activityId' &&
            (entry as unknown as Record<string, unknown>)[k] !== undefined,
        ),
  };
}

type CaptureOutcome = 'captured' | 'throttled' | 'timeout' | 'no-hydration';

interface CaptureResult {
  outcome: CaptureOutcome;
  durationMs: number;
  parsedFieldKeys?: string[];
}

/**
 * Open one analytics page and wait for its capture. Outcomes:
 *   - 'captured': content script scraped successfully.
 *   - 'throttled': content script saw LinkedIn's "Trouble Loading"
 *     page and emitted a throttle marker.
 *   - 'no-hydration': page didn't show engagement labels OR throttle
 *     text within PRIMARY_TIMEOUT_MS — content script emitted a no-
 *     hydration marker plus a fingerprint to the diagnostic buffer.
 *   - 'timeout': no buffer entry of any kind landed within the tab
 *     window (page hung, content script never loaded, tab errored).
 * Tab always closed before returning.
 */
async function captureOnePost(
  activityId: string,
  windowId: number | undefined,
): Promise<CaptureResult> {
  const started = Date.now();
  // Defense against the bufferLookup race: an entry for this
  // activityId may already be in the buffer from a previous tick (the
  // buffer flushes only at end-of-run). Without this clear, the orch-
  // estrator would poll bufferLookup, find the old entry instantly,
  // and return 'captured' in <100ms — no real capture would happen.
  // We delete any pre-existing entry so bufferLookup is forced to
  // wait for a NEW emission from this tick's content script run.
  await clearBufferEntry(activityId);
  let tabId: number | undefined;
  try {
    // active=true inside our dedicated popup keeps Chrome from
    // throttling the tab's JS timers (which previously stalled React
    // hydration on the analytics page past our 20s timeout). The
    // popup itself was created with focused=false so the user's main
    // window keeps focus.
    const tab = await chrome.tabs.create({
      url: POST_SUMMARY_URL_TEMPLATE(activityId),
      active: true,
      windowId,
    });
    tabId = tab.id;
    while (Date.now() - started < ORCH_PER_POST_TIMEOUT_MS) {
      const look = await bufferLookup(activityId);
      if (look.present) {
        const outcome: CaptureOutcome = look.throttled
          ? 'throttled'
          : look.noHydration
            ? 'no-hydration'
            : 'captured';
        return {
          outcome,
          durationMs: Date.now() - started,
          parsedFieldKeys: look.parsedFieldKeys,
        };
      }
      await sleep(ORCH_BUFFER_POLL_MS);
    }
    return { outcome: 'timeout', durationMs: Date.now() - started };
  } finally {
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Tab may have closed itself (navigation error, etc.). Ignore.
      }
    }
  }
}

function scheduleBackfillTick(): void {
  const delaySeconds =
    ORCH_RATE_LIMIT_MIN_MS / 1000 +
    Math.floor(
      Math.random() *
        ((ORCH_RATE_LIMIT_MAX_MS - ORCH_RATE_LIMIT_MIN_MS) / 1000),
    );
  chrome.alarms.create(BACKFILL_ALARM, {
    delayInMinutes: delaySeconds / 60,
  });
}

/**
 * One iteration of the alarm-driven backfill. Each tick: re-fetch the
 * remaining queue from the server, capture the next post, persist
 * counters, schedule the next tick. The SW can die between ticks —
 * the alarm wakes a fresh one. Replaces the old runOrchestrator that
 * used in-memory setTimeout sleeps and was killed mid-loop by Chrome's
 * MV3 idle SW termination.
 */
async function backfillOneTick(): Promise<void> {
  const settings = await getSettings();
  if (!settings) return;

  const status = await readStatus();
  const prev = status.backfill;
  if (!prev || prev.status !== 'running') return; // orphan tick

  // --- Abort guards: consecutive non-captures + runaway-cap -----------
  // One unified counter for any non-'captured' outcome (throttled /
  // timeout / no-hydration). The previous split counters had a bug:
  // each outcome reset the OTHER counter to 0, so an alternating
  // pattern (which is exactly what LinkedIn serves under sustained
  // pressure) never tripped the abort and the run wasted ~2 hours
  // before hitting the runaway cap.
  if (prev.consecutiveNonCaptured >= ORCH_MAX_CONSECUTIVE_NON_CAPTURED) {
    await abortBackfill(
      prev,
      `aborted after ${prev.consecutiveNonCaptured} consecutive non-captures ` +
        `(throttled / timeout / no-hydration). Check the tick log + page ` +
        `fingerprints in the popup to see what LinkedIn actually served.`,
    );
    return;
  }
  // Defense against runaway alarm chains (e.g. queue endpoint never
  // empties because every snapshot inserts with imp=0 but DB query
  // looks for non-zero). Cap total ticks at total + 5 (small margin
  // for legitimate retries on transient errors).
  if (prev.completed > prev.total + 5) {
    await abortBackfill(
      prev,
      `aborted: completed (${prev.completed}) exceeded queue size + 5 ` +
        `— possible runaway, check capture success rate`,
    );
    return;
  }

  // Re-fetch the queue every tick — server is the source of truth.
  // We pull a generous batch and filter out activity IDs we've already
  // attempted in THIS run; the server can keep returning the same
  // top-priority post when its just-captured snapshot doesn't satisfy
  // the queue's "done today" predicate, which would otherwise trap
  // the orchestrator on one post until the runaway cap fires.
  const visited = new Set(prev.visitedIds ?? []);
  const ids = await fetchActivityIdsToBackfill(settings, 50);
  const id = ids.find((i) => !visited.has(i));
  if (!id) {
    await writeStatus({
      backfill: {
        ...prev,
        status: 'done',
        finishedAt: new Date().toISOString(),
        currentActivityId: null,
      },
    });
    await stripDiagnosticMarkers();
    await flushBackfillBuffer();
    await closeBackfillWindow(prev.windowId);
    return;
  }
  await writeStatus({
    backfill: { ...prev, currentActivityId: id },
  });

  let result: CaptureResult = { outcome: 'timeout', durationMs: 0 };
  try {
    result = await captureOnePost(id, prev.windowId);
  } catch (err) {
    console.error('[backfill tick]', id, err);
  }

  // Persist a per-tick log entry for offline diagnosis. Always written
  // regardless of outcome, capped at TICK_LOG_CAP entries.
  await appendTickLog({
    capturedAt: new Date().toISOString(),
    activityId: id,
    outcome: result.outcome,
    durationMs: result.durationMs,
    parsedFieldKeys: result.parsedFieldKeys,
  });

  // Re-read in case parallel writes happened (unlikely but cheap).
  const after = (await readStatus()).backfill ?? prev;
  const next: BackfillState = {
    ...after,
    completed: after.completed + 1,
    consecutiveNonCaptured:
      result.outcome === 'captured' ? 0 : after.consecutiveNonCaptured + 1,
    currentActivityId: id,
    // Mark the ID as visited regardless of outcome — failed attempts
    // shouldn't trap the run on a single post either. The server-side
    // queue still surfaces failed-today posts on the NEXT run (fresh
    // visitedIds), giving them another chance.
    visitedIds: [...(after.visitedIds ?? []), id],
  };
  await writeStatus({ backfill: next });

  // If we just hit the abort threshold, the next tick will mark
  // status=error before doing anything else. Schedule it anyway —
  // simplifies control flow.
  scheduleBackfillTick();
}

async function abortBackfill(
  prev: BackfillState,
  reason: string,
): Promise<void> {
  await chrome.alarms.clear(BACKFILL_ALARM);
  await writeStatus({
    backfill: {
      ...prev,
      status: 'error',
      error: reason,
      finishedAt: new Date().toISOString(),
      currentActivityId: null,
    },
  });
  await stripDiagnosticMarkers();
  await flushBackfillBuffer();
  await closeBackfillWindow(prev.windowId);
}

async function stripDiagnosticMarkers(): Promise<void> {
  const buf = await readPostAnalyticsBuffer();
  const real = buf.filter(
    (a) =>
      a.throttled !== true &&
      (a as { noHydration?: true }).noHydration !== true,
  );
  if (real.length !== buf.length) {
    await writePostAnalyticsBuffer(real);
  }
}

/**
 * Push the buffered analytics out to the server at end of a backfill
 * run (done or aborted). The old in-memory orchestrator did this
 * automatically; in the alarm-chain version it has to fire from the
 * terminal tick. Errors are logged — runIngest writes its own status
 * line so we don't need to surface them on backfill state.
 */
async function flushBackfillBuffer(): Promise<void> {
  try {
    await runIngest();
  } catch (err) {
    console.error('[backfill] post-run ingest failed:', err);
  }
}

async function fetchActivityIdsToBackfill(
  settings: ExtensionSettings,
  limit = 10,
): Promise<string[]> {
  // /api/posts-needing-capture returns posts ordered by "never captured
  // first, then oldest snapshot". Each tick fetches just one (limit=1)
  // — the alarm chain handles cadence, server handles ordering.
  const base = settings.ingestUrl.replace(/\/api\/ingest\/?$/, '');
  const url = `${base}/api/posts-needing-capture?limit=${limit}`;
  const resp = await fetch(url, {
    headers: { 'X-Ingest-Secret': settings.ingestSecret },
  });
  if (!resp.ok) {
    throw new Error(`posts-needing-capture HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { activityIds?: string[] };
  return Array.isArray(body.activityIds) ? body.activityIds : [];
}

// ---------------------------------------------------------------------------
// ID resolver — one-shot migration for legacy posts whose DB rows have
// `urn:li:share:X` or `urn:li:ugcPost:X`-style URLs. Visits each page,
// lets the content script extract the real `urn:li:activity:Y` URN,
// then POSTs to /api/resolve-activity-id to rewrite the DB row. After
// this runs, the normal backfill orchestrator can capture their analytics.
// ---------------------------------------------------------------------------

interface NeedingResolve {
  oldActivityId: string;
  postUrl: string;
}

async function fetchPostsNeedingIdResolve(
  settings: ExtensionSettings,
): Promise<NeedingResolve[]> {
  const base = settings.ingestUrl.replace(/\/api\/ingest\/?$/, '');
  const resp = await fetch(`${base}/api/posts-needing-id-resolve`, {
    headers: { 'X-Ingest-Secret': settings.ingestSecret },
  });
  if (!resp.ok) {
    throw new Error(`posts-needing-id-resolve HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as {
    activityIds?: string[];
    urlsByActivityId?: Record<string, string>;
  };
  const ids = Array.isArray(body.activityIds) ? body.activityIds : [];
  const urls = body.urlsByActivityId ?? {};
  return ids.map((id) => ({
    oldActivityId: id,
    postUrl:
      urls[id] ??
      `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`,
  }));
}

async function postResolvedId(
  settings: ExtensionSettings,
  oldId: string,
  newId: string | null,
): Promise<boolean> {
  const base = settings.ingestUrl.replace(/\/api\/ingest\/?$/, '');
  try {
    const resp = await fetch(`${base}/api/resolve-activity-id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': settings.ingestSecret,
      },
      body: JSON.stringify({
        oldActivityId: oldId,
        newActivityId: newId,
        newPostUrl:
          newId != null
            ? `https://www.linkedin.com/feed/update/urn:li:activity:${newId}/`
            : undefined,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

const RESOLVER_PER_POST_TIMEOUT_MS = 20_000;
const RESOLVER_POLL_MS = 500;
// chrome.alarms minimum delay is 30s (1/2 minute). We use that floor
// and add jitter up to ~90s total to avoid bot-pattern detection
// while still finishing the queue in a reasonable wall-clock time.
const RESOLVER_TICK_MIN_S = 30;
const RESOLVER_TICK_MAX_S = 90;

function scheduleResolverTick(): void {
  const delaySeconds =
    RESOLVER_TICK_MIN_S +
    Math.floor(Math.random() * (RESOLVER_TICK_MAX_S - RESOLVER_TICK_MIN_S));
  // delayInMinutes accepts fractions — 0.5 = 30s, 1.5 = 90s.
  chrome.alarms.create(ID_RESOLVER_ALARM, {
    delayInMinutes: delaySeconds / 60,
  });
}

/**
 * Kick off the resolver: clear state, seed status, schedule the first
 * tick. The actual work happens in resolveOneTick, which re-schedules
 * itself via a fresh alarm after each iteration. Using chrome.alarms
 * instead of setTimeout loops makes the run survive Chrome MV3's
 * aggressive service-worker termination during idle periods.
 */
async function runIdResolver(): Promise<void> {
  // Clear any in-flight buffer from a prior (likely SW-killed) run.
  await writeResolvedBuffer({});
  // Cancel any leftover alarm so we don't double-fire.
  await chrome.alarms.clear(ID_RESOLVER_ALARM);

  const settings = await getSettings();
  if (!settings) throw new Error('not configured');

  const list = await fetchPostsNeedingIdResolve(settings);
  const state: IdResolverState = {
    status: 'running',
    total: list.length,
    completed: 0,
    resolved: 0,
    failed: 0,
    lastMapping: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  await writeStatus({ idResolver: state });

  if (list.length === 0) {
    state.status = 'done';
    state.finishedAt = new Date().toISOString();
    await writeStatus({ idResolver: { ...state } });
    return;
  }

  // Schedule the first tick immediately (500ms) so there's visible
  // progress right after the user clicks the button.
  chrome.alarms.create(ID_RESOLVER_ALARM, { delayInMinutes: 0.01 });
}

/**
 * One iteration of the resolver: re-fetch the queue, pick the next
 * post, visit it, POST the resolution, update status, schedule the
 * next tick. When the queue is empty, mark done and stop scheduling.
 *
 * This is called both on user-click (via runIdResolver → alarm) and
 * on every alarm fire. Crucially, it re-fetches the list from the
 * server each time — so the loop is stateless from the extension's
 * perspective and survives SW death between ticks.
 */
async function resolveOneTick(): Promise<void> {
  const settings = await getSettings();
  if (!settings) return;
  const list = await fetchPostsNeedingIdResolve(settings);

  // Read current state so we can increment counters.
  const status = await readStatus();
  const prev = status.idResolver;
  // If prev is missing or already marked done, this is an orphan
  // alarm (left over from a prior session). Just drop it.
  if (!prev || prev.status !== 'running') return;

  if (list.length === 0) {
    const done: IdResolverState = {
      ...prev,
      status: 'done',
      finishedAt: new Date().toISOString(),
    };
    await writeStatus({ idResolver: done });
    return;
  }

  const { oldActivityId, postUrl } = list[0];
  let tabId: number | undefined;
  let newId: string | null = null;
  try {
    const tab = await chrome.tabs.create({ url: postUrl, active: false });
    tabId = tab.id;
    const started = Date.now();
    while (Date.now() - started < RESOLVER_PER_POST_TIMEOUT_MS) {
      const buf = await readResolvedBuffer();
      if (oldActivityId in buf) {
        newId = buf[oldActivityId];
        delete buf[oldActivityId];
        await writeResolvedBuffer(buf);
        break;
      }
      await sleep(RESOLVER_POLL_MS);
    }
  } catch (err) {
    console.error('[id-resolver tick]', oldActivityId, err);
  } finally {
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // tab may have closed itself; ignore
      }
    }
  }

  if (newId) {
    const ok = await postResolvedId(settings, oldActivityId, newId);
    if (ok) prev.resolved++;
    else prev.failed++;
  } else {
    // POST null so the server marks idResolveAttemptedAt and excludes
    // this row from retries for 24h — otherwise the alarm chain
    // infinite-loops on unresolvable posts (deleted / auth-walled /
    // etc) since they stay in the queue indefinitely.
    await postResolvedId(settings, oldActivityId, null);
    prev.failed++;
  }
  prev.completed = prev.resolved + prev.failed;
  prev.lastMapping = { oldId: oldActivityId, newId };
  await writeStatus({ idResolver: { ...prev } });

  // Schedule the next tick — no explicit awaits between; the SW can
  // die and the alarm will re-wake it.
  scheduleResolverTick();
}

async function startBackfillRun(): Promise<void> {
  // Clear any leftover alarm so we don't double-fire.
  await chrome.alarms.clear(BACKFILL_ALARM);

  // Write an initial state immediately so the Options page shows
  // "Backfill: running 0/?" right after the button is clicked.
  await writeStatus({
    backfill: {
      status: 'running',
      total: 0,
      completed: 0,
      currentActivityId: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      consecutiveNonCaptured: 0,
      visitedIds: [],
    },
  });

  const settings = await getSettings();
  if (!settings) {
    throw new Error('not configured — set URL + secret in Options first');
  }

  // Probe the queue size so the status panel shows a meaningful
  // total. We then drop the result on the floor — each tick re-fetches
  // limit=1 from the server, which is the source of truth for queue
  // ordering.
  const initialIds = await fetchActivityIdsToBackfill(settings, 50);
  const total = initialIds.length;

  if (total === 0) {
    await writeStatus({
      backfill: {
        status: 'done',
        total: 0,
        completed: 0,
        currentActivityId: null,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        consecutiveNonCaptured: 0,
        visitedIds: [],
      },
    });
    return;
  }

  // Open a small popup window the orchestrator can drop capture tabs
  // into with active=true. Without this, tabs created in the user's
  // main window as active=false get Chrome's background-tab JS-timer
  // throttle, which stalls the analytics page's React hydration past
  // our 20s cap. focused=false keeps the user's main window in focus.
  let windowId: number | undefined;
  try {
    const win = await chrome.windows.create({
      url: 'about:blank',
      type: 'popup',
      focused: false,
      width: 900,
      height: 700,
    });
    windowId = win?.id;
  } catch (err) {
    console.error('[backfill] failed to create capture window:', err);
    // Fall through with windowId undefined — chrome.tabs.create will
    // then place tabs in the current window. Worse UX but the run
    // can still proceed.
  }

  await writeStatus({
    backfill: {
      status: 'running',
      total,
      completed: 0,
      currentActivityId: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      consecutiveNonCaptured: 0,
      visitedIds: [],
      windowId,
    },
  });

  // Schedule the first tick almost immediately so progress shows up.
  chrome.alarms.create(BACKFILL_ALARM, { delayInMinutes: 0.01 });
}

async function closeBackfillWindow(windowId: number | undefined): Promise<void> {
  if (windowId == null) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // User may have closed it manually, or it may already be gone.
    // Either way, nothing to do.
  }
}
