// Content script (ISOLATED world) — runs on every linkedin.com page at
// document_start.
//
// Responsibilities:
//   1. Bridge captured payloads from the MAIN-world interceptor to the
//      background service worker (two kinds: "posts" from
//      voyagerFeedDashProfileUpdates and "profile" partial counts).
//   2. When loaded on a /analytics/post-summary/urn:li:activity:<id>/
//      page, wait for the RSC to hydrate then scrape the per-post
//      analytics DOM — saves, sends, followersGained, profileViewers,
//      linkEngagements, video metrics + reactions/comments/reposts as
//      they appear on that page (Phase 3d.B).

import type {
  PageCaptureMessage,
  PageFingerprint,
  ParsedPostAnalytics,
  WorkerMessage,
} from './types';
import {
  parsePostSummaryHtml,
  isDemographicsRetentionLimited,
  parseDemographicDetailHtml,
} from './voyager-post-summary-parser';
import { parseConnectionsCountFromText } from './voyager-profile-parser';

window.addEventListener('message', (event: MessageEvent) => {
  // Reject messages from other origins. Same-page postMessage within
  // linkedin.com has event.origin === location.origin.
  if (event.origin !== location.origin) return;

  const data = event.data as Partial<PageCaptureMessage> | undefined;
  if (!data || data.source !== 'linkedin-analytics-interceptor') return;

  let msg: WorkerMessage | null = null;
  if (data.kind === 'posts' && Array.isArray(data.posts) && data.posts.length > 0) {
    msg = {
      type: 'buffer-posts',
      posts: data.posts,
      pageUrl: data.pageUrl ?? location.href,
      capturedAt: data.capturedAt ?? new Date().toISOString(),
    };
  } else if (data.kind === 'profile' && data.profile) {
    msg = {
      type: 'buffer-profile',
      profile: data.profile,
      pageUrl: data.pageUrl ?? location.href,
      capturedAt: data.capturedAt ?? new Date().toISOString(),
    };
  }

  if (msg) {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Service worker may be dormant; Chrome wakes it on the next
      // message. Swallow the transient rejection.
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 3d.B — post-summary page DOM scraping
//
// The recon in 3d.A confirmed LinkedIn exposes saves, sends,
// followersGained, profileViewers, linkEngagements and the video metrics
// EXCLUSIVELY in React Server Components at
// `https://www.linkedin.com/analytics/post-summary/urn:li:activity:<id>/`.
// There is no Voyager JSON endpoint for these fields. Same fate as the
// follower count from Phase 3b.
//
// The page ships the content inside a <script> tag as an HTML-escaped
// string; React then hydrates it into the live DOM. We poll for the
// "Saves" label to appear (a reliable hydration signal), then feed
// `document.documentElement.outerHTML` into the pure parser and ship
// the result to the background worker via buffer-post-analytics.
//
// Runs once per page load. SPA navigation handling isn't needed here:
// the Phase 3d.C orchestrator opens each analytics page in a new tab,
// which triggers a fresh content script instance per capture.
// ---------------------------------------------------------------------------
// Accept both the literal and percent-encoded forms of the URN separator.
// Chrome's location.href sometimes reports ":" as "%3A" in the path of
// tabs opened programmatically via chrome.tabs.create — that was silently
// making the orchestrator capture zero posts in the first live run of
// Phase 3d.D even though tabs were visibly opening and closing.
const POST_SUMMARY_URL_RE =
  /\/analytics\/post-summary\/urn(?::|%3A)li(?::|%3A)activity(?::|%3A)(\d+)/i;
// Primary hydration signal — one of these means "engagement panel rendered".
const PRIMARY_LABELS = ['Saves', 'Followers gained from this post'];
const HYDRATION_POLL_MS = 500;
const PRIMARY_TIMEOUT_MS = 20_000;
// Video metrics (video_views, watch_time_seconds, average_watch_time_seconds)
// are NOT currently extractable — the "Video performance" section that
// contained them in the 3d.A recon fixture doesn't render in LinkedIn's
// current post-summary layout, at least not within a reasonable wait.
// The schema columns stay nullable so we can revisit without migrations
// if LinkedIn brings that section back or we find a different source.

function pageText(): string {
  return document.body?.textContent ?? '';
}

/**
 * LinkedIn's anti-bot throttle / "we can't load this right now" page.
 * Served when they detect rapid automated visits to analytics URLs.
 * Detected by the literal text "Trouble Loading" plus the copy that
 * accompanies it.
 */
function isThrottlePage(): boolean {
  const t = pageText();
  return (
    t.includes('Trouble Loading') ||
    t.includes('unable to load analytics') ||
    t.includes('Refresh page')
  );
}

/**
 * Fetch LinkedIn's dedicated demographic-detail page for an activity
 * and parse it. The post-summary page only shows top-1 per category
 * for the three visible categories (location, seniority, industry);
 * the detail page reveals top-N across all six categories.
 *
 * Same-origin fetch from a content-script running on linkedin.com
 * carries the user's session cookies automatically. Best-effort:
 * any HTTP / parse failure returns []. When the response contains
 * nothing the parser recognizes, we stash a small diagnostic into
 * chrome.storage.local so we can iterate on the parser without
 * needing the user to copy raw HTML out of DevTools.
 */
async function fetchDemographicDetail(
  activityId: string,
): Promise<ParsedDemographicEntry[]> {
  const url =
    `https://www.linkedin.com/analytics/demographic-detail/urn:li:activity:${activityId}/?metricType=IMPRESSIONS`;
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) return [];
  const html = await resp.text();
  // The detail page embeds full top-N as Voyager JSON — try the
  // dedicated parser first. Fall back to the post-summary parser
  // (which finds top-1 from rendered DOM) when the JSON parser
  // returns nothing.
  let demographics = parseDemographicDetailHtml(html);
  if (demographics.length === 0) {
    demographics = parsePostSummaryHtml(html).demographics ?? [];
  }
  // Diagnostic. We expect the detail page to expose top-N for all six
  // categories — somewhere in the 30+ entries range like the legacy
  // seed data had. If we got fewer, the fetch likely returned an SPA
  // shell or the DOM structure differs from what our parser handles.
  // Store a sample of the stripped + raw HTML so we can iterate
  // offline. Cap to 5 reports.
  if (demographics.length < 12) {
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    // The detail page embeds the demographic data as Voyager JSON
    // (HTML-escaped) inside the page. Capture wide chunks around each
    // dataPoints occurrence so we can read full entry shapes and the
    // surrounding category context. 5000 chars × 12 occurrences = 60KB
    // — enough for ALL six categories with ~10 entries each.
    const dataPointsSnippets: string[] = [];
    let pos = 0;
    while (dataPointsSnippets.length < 12) {
      const idx = html.indexOf('dataPoints', pos);
      if (idx < 0) break;
      dataPointsSnippets.push(
        html.slice(Math.max(0, idx - 500), idx + 4500),
      );
      pos = idx + 1;
    }
    // First-occurrence + 200-char-after for every category enum we
    // might encounter. LinkedIn uses Voyager-internal enums; need to
    // confirm exactly which ones map to our six schema categories.
    const categoryEnumSnippets: Record<string, string> = {};
    for (const needle of [
      'STRUCTURED_TITLE_OCCUPATION',
      'OCCUPATION_SENIORITY',
      'GEO_REGION',
      'GEO',
      'INDUSTRY_V2',
      'INDUSTRY',
      'COMPANY_SIZE',
      'STAFF_COUNT_RANGE',
      'CURRENT_COMPANY',
      'COMPANY',
      'FUNCTION',
      'COUNTRY',
    ]) {
      const idx = html.indexOf(needle);
      if (idx >= 0) {
        categoryEnumSnippets[needle] = html.slice(
          Math.max(0, idx - 80),
          idx + 220,
        );
      }
    }
    // Locate the first occurrence of likely value/percentage field
    // names so we know what shape the data is in. Numbers might be
    // stored as "value":22 (int), "valuePercent":0.22 (fraction),
    // "percentage":22, "label":"22%", etc.
    const fieldShapeSnippets: Record<string, string> = {};
    for (const needle of [
      '"percentage":',
      '"valuePercent":',
      '"value":',
      '"label":',
      '"name":{',
      '"name":"',
      '"text":',
      '"title":',
      '"subtext":',
      '"viewerCount":',
    ]) {
      const idx = html.indexOf(needle);
      if (idx >= 0) {
        fieldShapeSnippets[needle] = html.slice(
          Math.max(0, idx - 40),
          idx + 300,
        );
      }
    }
    // The detail page might ALSO render DOM with section headers for
    // each category ("Top job titles", etc.) — like the post-summary
    // page does, but with the full top-N. If the rendered DOM is
    // there, we can parse it instead of fighting with the JSON.
    // Capture a sample of the stripped text around any "Top X" header.
    const renderedHeaderSnippets: string[] = [];
    for (const header of [
      'Top demographics',
      'Top job titles',
      'Top locations',
      'Top seniorities',
      'Top industries',
      'Top companies',
      'Top company sizes',
      'Demographics by',
      'Viewers by',
    ]) {
      const idx = stripped.indexOf(header);
      if (idx >= 0) {
        renderedHeaderSnippets.push(
          `[${header}@${idx}] ${stripped.slice(idx, idx + 800)}`,
        );
      }
    }
    // Misc: response URL (catches auth redirects), content-type for
    // sanity, and a final-bytes sample of the raw HTML in case the
    // data lives at the end (some LinkedIn pages put RSC payload near
    // the bottom).
    const report = {
      activityId,
      capturedAt: new Date().toISOString(),
      url,
      responseUrl: resp.url,
      httpStatus: resp.status,
      contentType: resp.headers.get('content-type') ?? null,
      htmlLen: html.length,
      strippedLen: stripped.length,
      extractedCount: demographics.length,
      strippedSampleHead: stripped.slice(0, 2000),
      strippedSampleTail: stripped.slice(Math.max(0, stripped.length - 2000)),
      dataPointsSnippets,
      categoryEnumSnippets,
      fieldShapeSnippets,
      renderedHeaderSnippets,
    };
    chrome.storage.local.get(['demographicDetailMisses']).then((s) => {
      const arr: unknown[] = Array.isArray(s.demographicDetailMisses)
        ? s.demographicDetailMisses
        : [];
      arr.push(report);
      chrome.storage.local.set({ demographicDetailMisses: arr.slice(-5) });
    });
  }
  return demographics;
}

// Re-export the parser-side type so we can annotate the helper above.
type ParsedDemographicEntry = NonNullable<
  ReturnType<typeof parsePostSummaryHtml>['demographics']
>[number];

/**
 * Emit two signals when a post-summary page expires the hydration
 * timeout without showing engagement labels OR throttle text:
 *
 *   - A `noHydration: true` marker in the analytics buffer so the
 *     orchestrator's bufferLookup polling returns a recognizable
 *     outcome (instead of a tab-level timeout).
 *   - A PageFingerprint into a separate diagnostic ring buffer so we
 *     can read what LinkedIn actually served — the most common
 *     suspects are an "analytics not available for this post" variant
 *     (sub-threshold engagement, deleted post) and an unauthenticated
 *     redirect.
 */
function emitNoHydration(activityId: string): void {
  const marker: WorkerMessage = {
    type: 'buffer-post-analytics',
    analytics: { activityId, noHydration: true } as ParsedPostAnalytics & {
      noHydration: true;
    },
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  chrome.runtime.sendMessage(marker).catch(() => {});

  const t = pageText();
  const fingerprint: PageFingerprint = {
    activityId,
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title ?? '',
    textLen: t.length,
    textSample: t.slice(0, 600),
    primaryLabelsFound: PRIMARY_LABELS.filter((l) => t.includes(l)),
    isThrottlePage: isThrottlePage(),
  };
  const fpMsg: WorkerMessage = {
    type: 'buffer-page-fingerprint',
    fingerprint,
  };
  chrome.runtime.sendMessage(fpMsg).catch(() => {});
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, HYDRATION_POLL_MS));
  }
  return false;
}

/**
 * Force LinkedIn's below-the-fold sections (Discovery / Video
 * performance / Demographics) to actually render. Those sections use
 * IntersectionObserver-based lazy hydration — their children don't
 * exist in the DOM until the user scrolls near them. Since our scrape
 * is automated, we trigger the rendering ourselves by scrolling to
 * the bottom in steps, then jumping back to the top.
 */
async function scrollToHydrateLazySections(): Promise<void> {
  const maxY = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  const step = Math.round(window.innerHeight * 0.8);
  for (let y = 0; y <= maxY; y += step) {
    window.scrollTo(0, y);
    // Small pause lets the IntersectionObserver callbacks fire and React
    // render the newly-visible section.
    await new Promise((r) => setTimeout(r, 250));
  }
  // One more scroll to the very bottom + settle time for the last
  // section (demographics tends to be last).
  window.scrollTo(0, maxY);
  await new Promise((r) => setTimeout(r, 800));
  // Return to top so the user sees a normal view if they came here
  // through manual navigation.
  window.scrollTo(0, 0);
}

async function capturePostSummary(): Promise<void> {
  const m = POST_SUMMARY_URL_RE.exec(location.href);
  if (!m) return;
  const activityId = m[1];

  // Stage 1: wait for the engagement panel to render (required).
  // Break early if LinkedIn has served the "Trouble Loading" / "Data
  // unavailable" page — that's their anti-bot response once they
  // detect rapid automated visits. When we see it, emit a marker
  // entry to the buffer so the orchestrator can detect the block
  // pattern and abort the run, and skip the usual scrape.
  const blocked = await waitFor(
    () =>
      PRIMARY_LABELS.some((l) => pageText().includes(l)) ||
      isThrottlePage(),
    PRIMARY_TIMEOUT_MS,
  );
  if (!blocked) {
    // Silent-bail: page didn't hydrate to either a known-good or
    // known-bad state inside PRIMARY_TIMEOUT_MS. Previously we just
    // returned, leaving the orchestrator to time out at the tab level
    // with no diagnostic. Now we emit:
    //   1. A no-hydration marker into the analytics buffer so
    //      bufferLookup detects it (orchestrator returns 'no-hydration'
    //      instead of 'timeout').
    //   2. A page fingerprint into a separate diagnostic buffer with
    //      title / URL / sample text so we can tell apart "old post,
    //      no analytics", "auth wall", "redirect to feed", etc.
    emitNoHydration(activityId);
    return;
  }
  if (isThrottlePage()) {
    const msg: WorkerMessage = {
      type: 'buffer-post-analytics',
      analytics: { activityId, throttled: true } as ParsedPostAnalytics & {
        throttled: true;
      },
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
    };
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Stage 2: scroll through the whole page to force lazy-rendered
  // sections (Discovery / Demographics) to actually land in the DOM.
  // Without this, document.documentElement.outerHTML simply doesn't
  // contain those sections' values — they're rendered on-demand when
  // the user scrolls near them.
  await scrollToHydrateLazySections();

  // Prefer the URL's activityId over anything the parser infers — the
  // URL is always authoritative for "which post is this page about."
  const rawHtml = document.documentElement.outerHTML;
  const metrics = parsePostSummaryHtml(rawHtml);
  const analytics = { ...metrics, activityId };

  // Try to upgrade the demographics from "top-1 per visible category"
  // (what the post-summary page renders) to "top-N across all six
  // categories" by fetching the dedicated demographic-detail page that
  // LinkedIn renders behind the "Show all" link. Best-effort: any
  // failure keeps whatever the post-summary parse returned.
  try {
    const detailDemographics = await fetchDemographicDetail(activityId);
    if (
      detailDemographics.length > (analytics.demographics?.length ?? 0)
    ) {
      analytics.demographics = detailDemographics;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[linkedin-analytics] demographic-detail fetch failed', e);
  }

  // Diagnostic: when the parser fails to extract impressions even though
  // the page hydrated past the throttle gate, capture a small snippet
  // around the "Impressions" / "Members reached" labels so we can study
  // the layout offline. Cheap (a substring slice), only fires on the
  // failure path, and stored in chrome.storage.local — surface via
  // popup later. Limit to ~50 captures so storage doesn't balloon.
  // Strip the page once for both diagnostic flows below.
  const strippedText = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39);/g, (m) =>
      ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'" }[m] ?? m),
    )
    .replace(/\s+/g, ' ');

  if (metrics.impressions === undefined) {
    // Slice ~400 chars around each label hit so we get the surrounding
    // tokens without dumping the whole DOM.
    const snippets: string[] = [];
    for (const label of ['Impressions', 'Members reached', 'Discovery']) {
      const idx = strippedText.indexOf(label);
      if (idx >= 0) {
        snippets.push(
          `[${label}@${idx}] …${strippedText.slice(Math.max(0, idx - 200), idx + 400)}…`,
        );
      } else {
        snippets.push(`[${label}] NOT FOUND in stripped text`);
      }
    }
    const report = {
      activityId,
      capturedAt: new Date().toISOString(),
      url: location.href,
      textLen: strippedText.length,
      sawAnyMetric:
        metrics.reactions !== undefined ||
        metrics.comments !== undefined ||
        metrics.membersReached !== undefined,
      snippets,
    };
    chrome.storage.local.get(['parserMisses']).then((s) => {
      const arr: unknown[] = Array.isArray(s.parserMisses) ? s.parserMisses : [];
      arr.push(report);
      const trimmed = arr.slice(-50);
      chrome.storage.local.set({ parserMisses: trimmed });
    });
    // eslint-disable-next-line no-console
    console.warn(
      '[linkedin-analytics] parser miss for activity',
      activityId,
      report,
    );
  } else if (
    (!metrics.demographics || metrics.demographics.length === 0) &&
    !isDemographicsRetentionLimited(strippedText)
  ) {
    // Demographic-miss telemetry: parser captured impressions (page
    // hydrated correctly) but extractDemographics returned nothing
    // AND it's not the retention-limited placeholder ("We aren't able
    // to show impression demographics after 360 days") — so it must
    // mean the live DOM's demographic block has a different shape
    // than the test fixture. Snapshot the text around each category
    // label so we can study the actual layout offline and update the
    // parser.
    const labels = [
      'Job title',
      'Location',
      'Seniority',
      'Industry',
      'Company size',
      'Company',
      'Demographics',
      'Top job titles',
      'Top locations',
      'Top industries',
      'Top companies',
      'Top seniorities',
      'Top company sizes',
    ];
    const snippets: string[] = [];
    for (const label of labels) {
      const idx = strippedText.indexOf(label);
      if (idx >= 0) {
        snippets.push(
          `[${label}@${idx}] …${strippedText.slice(Math.max(0, idx - 100), idx + 600)}…`,
        );
      }
    }
    const report = {
      activityId,
      capturedAt: new Date().toISOString(),
      url: location.href,
      textLen: strippedText.length,
      labelsFound: snippets.length,
      snippets,
    };
    chrome.storage.local.get(['demographicMisses']).then((s) => {
      const arr: unknown[] = Array.isArray(s.demographicMisses)
        ? s.demographicMisses
        : [];
      arr.push(report);
      const trimmed = arr.slice(-50);
      chrome.storage.local.set({ demographicMisses: trimmed });
    });
    // eslint-disable-next-line no-console
    console.warn(
      '[linkedin-analytics] demographic miss for activity',
      activityId,
      report,
    );
  }

  const msg: WorkerMessage = {
    type: 'buffer-post-analytics',
    analytics,
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
  };
  chrome.runtime.sendMessage(msg).catch(() => {
    // dormant service worker; it'll wake on next message
  });
}

// Kick off on page load. Using requestIdleCallback would be ideal but
// isn't always present in content script isolated world on MV3, so a
// small fixed delay before starting the hydration poll is enough.
if (POST_SUMMARY_URL_RE.test(location.href)) {
  void capturePostSummary();
}

// ---------------------------------------------------------------------------
// Connections-list DOM scrape.
//
// /mynetwork/invite-connect/connections/ renders the total-count header
// in the user's UI language (e.g. "347 connections"). The MAIN-world
// interceptor used to catch this from the voyager connectionsSummary
// endpoint, but LinkedIn evidently stopped firing that call on this
// page (observed 2026-04: two consecutive timeouts at 40s even in a
// foreground tab). The DOM scrape works regardless — read the number
// out of the visible body text, post to buffer-profile as usual.
// ---------------------------------------------------------------------------
const CONNECTIONS_LIST_URL_RE = /\/mynetwork\/invite-connect\/connections(?:\/|$)/i;
const CONNECTIONS_DOM_POLL_MS = 500;
const CONNECTIONS_DOM_TIMEOUT_MS = 20_000;

function sendDebug(message: string): void {
  const m: WorkerMessage = { type: 'connections-scrape-debug', message };
  chrome.runtime.sendMessage(m).catch(() => {
    // Service worker dormant — best-effort; next message wakes it.
  });
}

async function captureConnectionsListDom(): Promise<void> {
  sendDebug(`scrape-start: ${location.href} @ ${new Date().toISOString()}`);
  const deadline = Date.now() + CONNECTIONS_DOM_TIMEOUT_MS;
  let tick = 0;
  while (Date.now() < deadline) {
    const txt = pageText();
    const count = parseConnectionsCountFromText(txt);
    if (count != null) {
      sendDebug(
        `scrape-match: count=${count} after ${tick} polls (bodyLen=${txt.length})`,
      );
      const msg: WorkerMessage = {
        type: 'buffer-profile',
        profile: { totalConnections: count },
        pageUrl: location.href,
        capturedAt: new Date().toISOString(),
      };
      chrome.runtime.sendMessage(msg).catch(() => {});
      return;
    }
    tick++;
    await new Promise((r) => setTimeout(r, CONNECTIONS_DOM_POLL_MS));
  }
  // Timed out. Pull a sample of the body text near the first
  // "connect"/"conex"/"relac" substring so we can see what LinkedIn
  // is actually rendering and why the regex missed.
  const sample = pageText().replace(/\s+/g, ' ');
  const hit = sample.search(/connect|conex|relac/i);
  const snippet =
    hit >= 0
      ? `near: "${sample.slice(Math.max(0, hit - 40), hit + 80)}"`
      : 'no connect-like substring in body text';
  sendDebug(
    `scrape-timeout after ${tick} polls. bodyLen=${sample.length}. ${snippet}`,
  );
}

if (CONNECTIONS_LIST_URL_RE.test(location.href)) {
  sendDebug(`url-matched: ${location.href}`);
  void captureConnectionsListDom();
}

// ---------------------------------------------------------------------------
// Legacy ID resolver.
//
// The /feed/update/urn:li:share:X/ and /feed/update/urn:li:ugcPost:X/
// pages serve posts whose CANONICAL URN is actually urn:li:activity:Y
// (a different number than X). We need Y for the analytics endpoint
// to work. LinkedIn embeds both URNs in the page — look for the
// activity URN in og:url / canonical link / the HTML body, in that
// order of preference. Send the resolved URN back to the background
// worker, which POSTs to /api/resolve-activity-id.
// ---------------------------------------------------------------------------
const LEGACY_UPDATE_URL_RE =
  /\/feed\/update\/urn(?::|%3A)li(?::|%3A)(share|ugcPost)(?::|%3A)(\d+)/i;
const RESOLVER_POLL_MS = 500;
const RESOLVER_TIMEOUT_MS = 15_000;

function findActivityUrnInDocument(): string | null {
  // 1. og:url — LinkedIn sets the canonical post URL here, usually
  //    with the activity URN.
  const og = document.querySelector('meta[property="og:url"]');
  const ogHref = og?.getAttribute('content') ?? '';
  const ogMatch = ogHref.match(/urn[:%]3[Aa]li[:%]3[Aa]activity[:%]3[Aa](\d+)/i);
  if (ogMatch) return ogMatch[1];

  // 2. canonical link
  const canonical = document.querySelector('link[rel="canonical"]');
  const canHref = canonical?.getAttribute('href') ?? '';
  const canMatch = canHref.match(/urn[:%]3[Aa]li[:%]3[Aa]activity[:%]3[Aa](\d+)/i);
  if (canMatch) return canMatch[1];

  // 3. fall back to the first urn:li:activity reference anywhere in
  //    the HTML. LinkedIn's embedded JSON payloads usually have one.
  const html = document.documentElement.outerHTML;
  const bodyMatch = html.match(/urn:li:activity:(\d+)/);
  if (bodyMatch) return bodyMatch[1];
  return null;
}

async function resolveActivityId(oldId: string): Promise<void> {
  const deadline = Date.now() + RESOLVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const newId = findActivityUrnInDocument();
    if (newId && newId !== oldId) {
      chrome.runtime
        .sendMessage({
          type: 'resolved-activity-id',
          oldActivityId: oldId,
          newActivityId: newId,
          pageUrl: location.href,
        })
        .catch(() => {});
      return;
    }
    await new Promise((r) => setTimeout(r, RESOLVER_POLL_MS));
  }
  // Timed out — tell background so the orchestrator can move on.
  chrome.runtime
    .sendMessage({
      type: 'resolved-activity-id',
      oldActivityId: oldId,
      newActivityId: null,
      pageUrl: location.href,
    })
    .catch(() => {});
}

const legacyMatch = LEGACY_UPDATE_URL_RE.exec(location.href);
if (legacyMatch) {
  void resolveActivityId(legacyMatch[2]);
}
