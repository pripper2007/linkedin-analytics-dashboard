// MAIN-world interceptor — loaded as a content_scripts entry with
// "world": "MAIN" and "run_at": "document_start" so it runs BEFORE any
// LinkedIn script. No Chrome APIs available here; we talk to the
// isolated-world content script via window.postMessage.
//
// Why the getter/setter traps:
//   LinkedIn's flagship bundle (apfc instrumentation) reassigns
//   `window.fetch = their-wrapper` and `XMLHttpRequest.prototype.open/send`
//   outright after we install. A one-shot monkey-patch gets clobbered.
//   Installing Object.defineProperty getter/setter traps makes every
//   reassignment flow through our setter, which wraps the new value with
//   our interceptor, keeping us in the chain.
//
// Endpoints captured:
//   - voyagerFeedDashProfileUpdates.<queryId>        → per-post metrics
//   - /voyager/api/relationships/connectionsSummary  → connection count
//
// Follower count is NOT here: as of 2026-04 LinkedIn only renders it in
// server-side HTML via RSC, so the background worker fetches the profile
// page HTML on its daily tick. See background.ts → fetchFollowerCount.
//
// Debug affordances in this world's `window`:
//   - __linkedinAnalyticsInterceptorInstalled : true only AFTER patching
//   - __linkedinAnalyticsCaptures             : ring buffer of matched URLs
//   - __linkedinAnalyticsLastRaw              : last captured JSON
//   - __linkedinAnalyticsLastParseCount       : posts returned by last parse
//   - __linkedinAnalyticsLastParseError       : last parse failure (if any)

import type { PageCaptureMessage, ParsedProfile } from './types';
import {
  parseFeedDashProfileUpdates,
  isFeedDashProfileUpdatesUrl,
} from './voyager-parser';
import {
  parseConnectionsSummary,
  isConnectionsSummaryUrl,
} from './voyager-profile-parser';

declare global {
  // eslint-disable-next-line no-var
  var __linkedinAnalyticsInterceptorInstalled: boolean | undefined;
  // eslint-disable-next-line no-var
  var __linkedinAnalyticsCaptures: string[] | undefined;
  // eslint-disable-next-line no-var
  var __linkedinAnalyticsLastRaw: unknown;
  // eslint-disable-next-line no-var
  var __linkedinAnalyticsLastParseCount: number | undefined;
  // eslint-disable-next-line no-var
  var __linkedinAnalyticsLastParseError: string | undefined;
}

const WRAPPED_MARK = Symbol.for('linkedin-analytics-wrapped');
const CAPTURE_LOG_MAX = 50;

if (!globalThis.__linkedinAnalyticsInterceptorInstalled) {
  try {
    globalThis.__linkedinAnalyticsCaptures = [];
    installFetchTrap();
    installXhrOpenTrap();
    installXhrSendTrap();
    globalThis.__linkedinAnalyticsInterceptorInstalled = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[linkedin-analytics] interceptor install failed:', err);
  }
}

// ---------------------------------------------------------------------------
// URL dispatch — which endpoints we care about and how to parse them.
// ---------------------------------------------------------------------------
type EndpointKind = 'posts' | 'profile-connections';

function endpointOf(url: string): EndpointKind | null {
  if (isFeedDashProfileUpdatesUrl(url)) return 'posts';
  if (isConnectionsSummaryUrl(url)) return 'profile-connections';
  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

function recordCapture(url: string): void {
  const log = globalThis.__linkedinAnalyticsCaptures;
  if (!log) return;
  log.push(url);
  if (log.length > CAPTURE_LOG_MAX) log.splice(0, log.length - CAPTURE_LOG_MAX);
}

function postMessageFromPage(msg: PageCaptureMessage): void {
  window.postMessage(msg, location.origin);
}

function dispatchParsed(kind: EndpointKind, json: unknown): void {
  globalThis.__linkedinAnalyticsLastRaw = json;
  try {
    switch (kind) {
      case 'posts': {
        const posts = parseFeedDashProfileUpdates(json);
        globalThis.__linkedinAnalyticsLastParseCount = posts.length;
        if (posts.length > 0) {
          postMessageFromPage({
            source: 'linkedin-analytics-interceptor',
            kind: 'posts',
            posts,
            pageUrl: location.href,
            capturedAt: new Date().toISOString(),
          });
        }
        break;
      }
      case 'profile-connections': {
        const count = parseConnectionsSummary(json);
        if (count != null) postProfile({ totalConnections: count });
        break;
      }
    }
  } catch (err) {
    globalThis.__linkedinAnalyticsLastParseError =
      err instanceof Error ? err.message : String(err);
  }
}

function postProfile(profile: ParsedProfile): void {
  postMessageFromPage({
    source: 'linkedin-analytics-interceptor',
    kind: 'profile',
    profile,
    pageUrl: location.href,
    capturedAt: new Date().toISOString(),
  });
}

async function readJsonFromXhr(xhr: XMLHttpRequest): Promise<unknown> {
  switch (xhr.responseType) {
    case 'json':
      return xhr.response;
    case 'blob': {
      const blob = xhr.response as Blob;
      const text = await blob.text();
      return JSON.parse(text);
    }
    case 'arraybuffer': {
      const buf = xhr.response as ArrayBuffer;
      return JSON.parse(new TextDecoder().decode(buf));
    }
    default:
      return JSON.parse(xhr.responseText);
  }
}

type Marked<T> = T & { [WRAPPED_MARK]?: true };

function isMarked<T extends object>(v: T | Marked<T>): v is Marked<T> {
  return (v as Marked<T>)[WRAPPED_MARK] === true;
}

function mark<T extends object>(v: T): Marked<T> {
  (v as Marked<T>)[WRAPPED_MARK] = true;
  return v as Marked<T>;
}

// ---------------------------------------------------------------------------
// window.fetch trap
// ---------------------------------------------------------------------------
function wrapFetch(orig: typeof fetch): typeof fetch {
  if (typeof orig !== 'function') return orig;
  if (isMarked(orig)) return orig;

  const patched = async function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await orig.call(this as never, input, init);
    try {
      const url = urlOf(input);
      const kind = endpointOf(url);
      if (kind) {
        recordCapture(url);
        response
          .clone()
          .json()
          .then((json) => dispatchParsed(kind, json))
          .catch((err: unknown) => {
            globalThis.__linkedinAnalyticsLastParseError =
              err instanceof Error ? err.message : String(err);
          });
      }
    } catch {
      // Never break the caller's fetch.
    }
    return response;
  } as typeof fetch;

  return mark(patched);
}

function installFetchTrap(): void {
  let current: typeof fetch = wrapFetch(window.fetch);
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    enumerable: true,
    get(): typeof fetch {
      return current;
    },
    set(next: typeof fetch): void {
      current = wrapFetch(next);
    },
  });
}

// ---------------------------------------------------------------------------
// XMLHttpRequest.prototype.open trap
// ---------------------------------------------------------------------------
type XhrOpen = XMLHttpRequest['open'];

function wrapXhrOpen(orig: XhrOpen): XhrOpen {
  if (typeof orig !== 'function') return orig;
  if (isMarked(orig)) return orig;

  const patched = function patchedOpen(
    this: XMLHttpRequest & { __laUrl?: string },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    this.__laUrl = url instanceof URL ? url.toString() : url;
    return (orig as (...args: unknown[]) => void).apply(this, [
      method,
      url,
      ...rest,
    ]);
  } as XhrOpen;

  return mark(patched);
}

function installXhrOpenTrap(): void {
  let current: XhrOpen = wrapXhrOpen(XMLHttpRequest.prototype.open);
  Object.defineProperty(XMLHttpRequest.prototype, 'open', {
    configurable: true,
    enumerable: true,
    get(): XhrOpen {
      return current;
    },
    set(next: XhrOpen): void {
      current = wrapXhrOpen(next);
    },
  });
}

// ---------------------------------------------------------------------------
// XMLHttpRequest.prototype.send trap
// ---------------------------------------------------------------------------
type XhrSend = XMLHttpRequest['send'];

function wrapXhrSend(orig: XhrSend): XhrSend {
  if (typeof orig !== 'function') return orig;
  if (isMarked(orig)) return orig;

  const patched = function patchedSend(
    this: XMLHttpRequest & { __laUrl?: string },
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = this.__laUrl;
    const kind = url ? endpointOf(url) : null;
    if (url && kind) {
      recordCapture(url);
      this.addEventListener('load', () => {
        readJsonFromXhr(this)
          .then((json) => dispatchParsed(kind, json))
          .catch((err: unknown) => {
            globalThis.__linkedinAnalyticsLastParseError =
              err instanceof Error ? err.message : String(err);
          });
      });
    }
    return (orig as (...args: unknown[]) => void).apply(
      this,
      body === undefined ? [] : [body],
    );
  } as XhrSend;

  return mark(patched);
}

function installXhrSendTrap(): void {
  let current: XhrSend = wrapXhrSend(XMLHttpRequest.prototype.send);
  Object.defineProperty(XMLHttpRequest.prototype, 'send', {
    configurable: true,
    enumerable: true,
    get(): XhrSend {
      return current;
    },
    set(next: XhrSend): void {
      current = wrapXhrSend(next);
    },
  });
}
