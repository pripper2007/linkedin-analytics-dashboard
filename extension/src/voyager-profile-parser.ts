// Parsers for profile-level rollups.
//
//   1. parseFollowerCountFromHtml — scrapes the follower count from the
//      server-rendered HTML of a LinkedIn profile page. As of 2026-04,
//      LinkedIn no longer returns this number in any Voyager JSON endpoint
//      (it's rendered via RSC), so the background worker fetches the
//      profile page HTML directly and we regex the number out.
//
//   2. parseConnectionsSummary — still works. Classic REST endpoint
//      /voyager/api/relationships/connectionsSummary returns
//      `{ entityUrn, numConnections }`. Captured opportunistically when the
//      user visits the My Network page.
//
// Both return null when the expected shape isn't present.

type Json = unknown;

function deepGet(obj: Json, path: string | string[]): Json {
  const keys = Array.isArray(path) ? path : [path];
  let cur: Json = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// -------------------------------------------------------------------------
// URL matcher for the connections endpoint
// -------------------------------------------------------------------------
const CONNECTIONS_SUMMARY_PATH = '/voyager/api/relationships/connectionsSummary';

export function isConnectionsSummaryUrl(url: string): boolean {
  return url.includes(CONNECTIONS_SUMMARY_PATH);
}

// -------------------------------------------------------------------------
// parseFollowerCountFromHtml
//
// LinkedIn renders the profile owner's follower count directly into the
// initial HTML document in the signed-in user's UI language, e.g.
//   en-US: `10,228 followers`
//   pt-BR: `10.228 seguidores`
// To tolerate markup between the number and the label we first strip tags
// (including <script>/<style> blocks, so embedded JSON doesn't pollute
// the match), then look for `<number> <label>` in the plain text. The
// first match is the profile header's own-count — recommended-people
// counts are delivered later via the RSC client stream, not the initial
// HTML.
//
// The number can contain either `,` or `.` as a thousands separator
// depending on locale. Both are stripped before parsing.
// -------------------------------------------------------------------------
// Note on the label alternation:
//   - `followers?` matches "follower" or "followers"
//   - `seguidor(?:es)?` matches "seguidor" or "seguidores"
//     (NOT `seguidores?`, which would match "seguidore"/"seguidores").
//
// Tail boundary is `(?![a-z])` — "not followed by a lowercase letter".
// We can't use `\b` here because the LinkedIn DOM sometimes collapses
// whitespace between the label and the next UI word ("connectionsSort"),
// and `\b` doesn't fire between two word characters regardless of case.
//
// We deliberately do NOT use the `i` flag: when combined with a lookahead
// like `(?!\p{Ll})` or `(?![a-z])`, JS case-folds the class to include
// both cases, which makes the lookahead reject uppercase letters too —
// defeating the whole point. Instead, label alternatives spell both
// capitalizations explicitly.
const FOLLOWER_LABEL_RE =
  /([\d.,]+)\s+(?:[Ff]ollowers?|[Ss]eguidor(?:es)?)(?![a-z])/;

export function parseFollowerCountFromHtml(html: string): number | null {
  const stripped = stripHtmlForTextScan(html);
  const match = stripped.match(FOLLOWER_LABEL_RE);
  if (!match) return null;
  const n = Number(match[1].replace(/[,.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function stripHtmlForTextScan(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * When the main regex misses, extract a short excerpt of stripped text
 * around the first "follower"/"seguidor" substring — so a human reading
 * the status panel can see what label LinkedIn actually rendered and we
 * can adjust the pattern without another round-trip.
 */
export function sampleFollowerLabelContext(
  html: string,
  radius = 60,
): string | null {
  const stripped = stripHtmlForTextScan(html).replace(/\s+/g, ' ');
  const anchor = stripped.search(/follower|seguidor/i);
  if (anchor < 0) return null;
  const start = Math.max(0, anchor - radius);
  const end = Math.min(stripped.length, anchor + radius);
  return stripped.slice(start, end).trim();
}

// -------------------------------------------------------------------------
// parseConnectionsSummary
// Response shape: `{ entityUrn, numConnections: 4882 }`.
// -------------------------------------------------------------------------
export function parseConnectionsSummary(json: Json): number | null {
  const n = deepGet(json, 'numConnections');
  return typeof n === 'number' ? n : null;
}

// -------------------------------------------------------------------------
// parseConnectionsCountFromText
//
// DOM-scraping fallback for when the voyager connectionsSummary endpoint
// isn't fired on the current page (observed 2026-04 on
// /mynetwork/invite-connect/connections/). The connection list page
// renders the total prominently in its header in the user's UI language.
// We scan visible body text for "N connections" (en) / "N conexões"
// (pt-BR) / "N connessioni" (it) and return the first match.
//
// Label alternation mirrors the follower scraper style — case-insensitive,
// locale aware, thousands separators stripped before parsing.
// -------------------------------------------------------------------------
// Tail boundary: `(?![a-z])` instead of `\b`. LinkedIn's DOM renders
// "4,884 connectionsSort by:..." with no whitespace between "connections"
// and "Sort", and `\b` fails to fire between two word characters (s→S).
// A simple "no lowercase letter follows" lookahead correctly accepts
// "connectionsS" (uppercase S → passes) while rejecting "connectionso".
//
// We do NOT use the `i` flag: combined with the lookahead, JS case-
// folding makes the class cover both cases, which nullifies the intent.
// Label alternatives spell both capitalizations explicitly.
//
// Leading `(\d[\d.,]*)` with no `\s+` prefix: the same DOM concatenates
// the upstream header text into the number (e.g. "Advertise4,884"), so
// requiring whitespace before the digits also breaks in practice.
const CONNECTIONS_LABEL_RE =
  /(\d[\d.,]*)\s+(?:[Cc]onnections?|[Cc]onex(?:ão|[oõ]es)|[Cc]onnessioni|Kontakte|[Cc]onexiones|[Rr]elacionamentos?)(?![a-z])/;

export function parseConnectionsCountFromText(text: string): number | null {
  const match = text.match(CONNECTIONS_LABEL_RE);
  if (!match) return null;
  const n = Number(match[1].replace(/[,.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
