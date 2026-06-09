// Parser for the rendered HTML of LinkedIn's per-post analytics page:
//   https://www.linkedin.com/analytics/post-summary/urn:li:activity:<id>/
//
// Why DOM scraping and not a Voyager endpoint: the recon in Phase 3d.A
// confirmed that saves, sends, followersGained, profileViewers,
// linkEngagements, videoViews and watchTime live ONLY in React Server
// Components on this page. `voyagerPremiumDashAnalyticsCard` returns
// `Internal error` for all of those resultTypes — they simply aren't
// resolved in the GraphQL schema. See docs/voyager-recon.md.
//
// LinkedIn embeds the rendered content inside `<script>` tags as an
// HTML-escaped RSC Flight string, then React hydrates it client-side.
// Either form works for us: after `html.unescape` + tag-strip, both
// produce identical plain text.
//
// Two layout patterns appear on the page:
//
//   * "top-card" style:  <p>NUMBER</p><p>LABEL</p>
//     — Impressions, Members reached, Video views,
//       Profile viewers from this post, Followers gained from this post,
//       Average watch time
//
//   * "engagement-row" style:  <p>LABEL</p><p>NUMBER</p>
//     — Reactions, Comments, Reposts, Saves, Sends on LinkedIn,
//       Link engagements, Watch time
//
// We run both passes and take the first hit per field.

/**
 * Metric-only result — the parser doesn't claim authority on activityId
 * (the URL is authoritative for that). The content script combines this
 * with its URL-derived activityId to produce a ParsedPostAnalytics
 * (see types.ts).
 *
 * All fields optional: absence means "not captured" (page hadn't
 * hydrated that section, or the post simply doesn't have that metric —
 * e.g. videoViews for an image-only post).
 */
export interface ParsedPostMetrics {
  activityId?: string;
  impressions?: number;
  membersReached?: number;
  /** Sum of all reaction types. */
  reactions?: number;
  comments?: number;
  reposts?: number;
  saves?: number;
  sends?: number;
  profileViewers?: number;
  followersGained?: number;
  /** LinkedIn's name for what the schema calls `link_clicks`. */
  linkEngagements?: number;
  videoViews?: number;
  /** Total watch time in seconds. */
  watchTimeSeconds?: number;
  /** Average per-viewer watch time in seconds. */
  averageWatchTimeSeconds?: number;
  /**
   * Per-post audience breakdown — top-N entries per category. Absent
   * when the demographics section hadn't lazy-rendered yet (the
   * orchestrator's scrollToHydrateLazySections step usually fixes
   * that, but very old posts and low-engagement posts may legitimately
   * have no demographics data even when fully hydrated).
   */
  demographics?: ParsedDemographicEntry[];
}

export interface ParsedDemographicEntry {
  category:
    | 'job_title'
    | 'location'
    | 'seniority'
    | 'company'
    | 'industry'
    | 'company_size';
  value: string;
  /** Numeric percentage 0–100. "<1%" → 0.5 (midpoint convention from seed). */
  pct: number;
  /** 1-based ordering inside the category, top-first. */
  rank: number;
}

/** @deprecated Use ParsedPostMetrics. Kept to avoid churning existing tests. */
export type ParsedPostAnalytics = ParsedPostMetrics;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** Minimal HTML unescape — covers the entities LinkedIn uses. */
function unescapeHtml(s: string): string {
  return s.replace(/&(?:lt|gt|amp|quot|apos|nbsp|#39);/g, (m) => HTML_ENTITIES[m] ?? m);
}

/** Strip tags, collapse whitespace. Turns the page into a plain word stream. */
function stripToText(html: string): string {
  return unescapeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Integer after a label in `...  LABEL 123  ...` form. */
function numAfter(text: string, label: string): number | null {
  const m = new RegExp(escapeForRegex(label) + String.raw`\s+([\d,]+)(?:\s|$)`).exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Integer before a label in `...  123 LABEL ...` form. */
function numBefore(text: string, label: string): number | null {
  const m = new RegExp(String.raw`(?:^|\s)([\d,]+)\s+` + escapeForRegex(label)).exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * LinkedIn's post-summary UI shifted from "NUMBER LABEL" (legacy) to
 * "LABEL NUMBER" (current as of 2026-04) for the Discovery and Profile
 * activity sections. Detect once per scrape and pick the right reader:
 *
 *   Number-first: "1,311 Impressions  859 Members reached"
 *   Label-first:  "Impressions 18,165 Members reached 7,820"
 *
 * We anchor on "Impressions" since that's the most stable label.
 */
function detectLayout(text: string): 'label-first' | 'number-first' {
  // Look at what tokens neighbor "Impressions". Either side missing
  // (start/end of string) → use whichever side IS a number to decide.
  const m = /(\S+)?\s*Impressions\s*(\S+)?/.exec(text);
  if (!m) return 'label-first';
  const before = m[1];
  const after = m[2];
  const beforeIsNum = !!before && /^[\d,]+$/.test(before);
  const afterIsNum = !!after && /^[\d,]+$/.test(after);
  // In number-first format both neighbors will typically be numeric —
  // the value before is Impressions's value, the value after is the
  // next field's value. In label-first, what's before is a non-numeric
  // section header ("Discovery"), only the after-number applies.
  if (beforeIsNum && afterIsNum) return 'number-first';
  if (beforeIsNum && !afterIsNum) return 'number-first';
  if (afterIsNum && !beforeIsNum) return 'label-first';
  return 'label-first';
}

/**
 * Parse LinkedIn's duration strings to seconds.
 *   "1h 29m"   → 5340
 *   "3m 42s"   → 222
 *   "11s"      → 11
 *   "45m"      → 2700
 *   "2h"       → 7200
 * Returns null if the string doesn't match any recognized shape.
 */
export function parseDurationToSeconds(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let total = 0;
  let matched = false;
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*m(?!s)/.exec(s); // `m` not followed by `s` (avoid "ms")
  const sec = /(\d+)\s*s/.exec(s);
  if (h) { total += Number(h[1]) * 3600; matched = true; }
  if (m) { total += Number(m[1]) * 60; matched = true; }
  if (sec) { total += Number(sec[1]); matched = true; }
  return matched ? total : null;
}

/** Extract a duration string that follows or precedes a label. */
function durationAfter(text: string, label: string): number | null {
  const re = new RegExp(
    escapeForRegex(label) + String.raw`\s+((?:\d+\s*[hms]\s*)+)`,
  );
  const m = re.exec(text);
  return m ? parseDurationToSeconds(m[1]) : null;
}

function extractActivityId(html: string): string | null {
  const m = /urn:li:activity:(\d+)/.exec(html);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parsePostSummaryHtml(html: string): ParsedPostMetrics {
  const text = stripToText(html);

  const out: ParsedPostMetrics = {};
  const set = <K extends keyof ParsedPostMetrics>(
    k: K,
    v: ParsedPostMetrics[K] | null,
  ) => {
    if (v != null) out[k] = v;
  };

  const id = extractActivityId(html);
  if (id) out.activityId = id;
  // Discovery + Profile activity sections. LinkedIn flipped these from
  // number-first (legacy fixture) to label-first (live as of 2026-04).
  // Detect the layout once and pick the matching reader.
  const layout = detectLayout(text);
  const numFromSection =
    layout === 'label-first' ? numAfter : numBefore;
  set('impressions', numFromSection(text, 'Impressions'));
  set('membersReached', numFromSection(text, 'Members reached'));
  set('videoViews', numFromSection(text, 'Video views'));
  set('profileViewers', numFromSection(text, 'Profile viewers from this post'));
  set('followersGained', numFromSection(text, 'Followers gained from this post'));
  // engagement-row style (label before number)
  set('reactions', numAfter(text, 'Reactions'));
  set('comments', numAfter(text, 'Comments'));
  set('reposts', numAfter(text, 'Reposts'));
  set('saves', numAfter(text, 'Saves'));
  set('sends', numAfter(text, 'Sends on LinkedIn'));
  set('linkEngagements', numAfter(text, 'Link engagements'));
  // durations — both labels FOLLOW the number-free template "LABEL
  // DURATION". "Watch time" is a substring of "Average watch time", so
  // we mask "Average watch time ..." clauses before the plain "Watch
  // time" search to avoid cross-contamination.
  set('watchTimeSeconds', extractWatchTime(text));
  set('averageWatchTimeSeconds', durationAfter(text, 'Average watch time'));

  const demographics = extractDemographics(text);
  if (demographics.length > 0) out.demographics = demographics;

  return out;
}

/**
 * Extract total "Watch time" while avoiding collisions with "Average watch
 * time". We do this by cutting the "Average watch time ..." clause out of
 * the search text before applying the regex.
 */
function extractWatchTime(text: string): number | null {
  const pruned = text.replace(/Average watch time\s+(?:\d+\s*[hms]\s*)+/gi, ' ');
  return durationAfter(pruned, 'Watch time');
}

// ---------------------------------------------------------------------------
// Demographics extraction
//
// LinkedIn's post-summary page renders a "Demographics" section with up to
// six tabbed categories. After scrollToHydrateLazySections forces the
// section into the DOM, the stripped text reads like:
//
//   ... Job title Senior Engineer 18% Software Engineer 12% ... Location
//   Greater Rio de Janeiro 32% Greater São Paulo 18% ...
//
// Strategy: locate each category label, then read (value, percentage) pairs
// until we hit the next category label or run out of % markers. The label
// occurrences inside the navigation tab strip have NO immediate "X%"
// after them, so the same logic naturally skips them.
// ---------------------------------------------------------------------------

const DEMO_CATEGORIES = [
  // Order matters: longer labels first so "Company size" matches before
  // a bare "Company" prefix would.
  { label: 'Company size', key: 'company_size' as const },
  { label: 'Job title', key: 'job_title' as const },
  { label: 'Seniority', key: 'seniority' as const },
  { label: 'Industry', key: 'industry' as const },
  { label: 'Location', key: 'location' as const },
  { label: 'Company', key: 'company' as const },
];

/** Captures a value preceding a "N%" or "<1%" token. */
const VALUE_PCT_RE = /([^%]+?)\s+(<\s*1\s*%|\d+\s*%)/g;

function parsePctToken(raw: string): number {
  const trimmed = raw.replace(/\s+/g, '');
  if (/^<1%$/i.test(trimmed)) return 0.5;
  const m = /^(\d+)%$/.exec(trimmed);
  return m ? Number(m[1]) : 0;
}

/**
 * Detect LinkedIn's "Some analytics are unavailable / We aren't able to
 * show impression demographics after 360 days" placeholder. Posts older
 * than 360 days hit this — distinct from a parser bug.
 */
export function isDemographicsRetentionLimited(text: string): boolean {
  return (
    /We\s+aren'?t\s+able\s+to\s+show\s+impression\s+demographics\s+after\s+360\s+days/i.test(
      text,
    ) || /Some\s+analytics\s+are\s+unavailable/i.test(text)
  );
}

// ---------------------------------------------------------------------------
// Demographic-detail page parser
//
// LinkedIn renders the per-post audience breakdown across two URLs:
//
//   /analytics/post-summary/.../          shows top-1 entry for three
//                                         categories (location, seniority,
//                                         industry) as rendered DOM
//                                         — handled by extractFromSubtitles.
//
//   /analytics/demographic-detail/.../    full top-N for all six categories
//                                         — but the data isn't rendered
//                                         DOM, it's HTML-escaped Voyager
//                                         JSON embedded in the response.
//
// The detail page contains six BarChart modules. Each module is structured
// as:
//
//   { dataPoints: [ ChartDataPoint1D, ... ] }, { ...BarChart with category }
//
// where the BarChart object holding the `"category":"X"` enum is a SIBLING
// that follows the dataPoints array — not its parent. So to associate a
// dataPoints array with a category, we look for the next `"category":"X"`
// AFTER the array's closing bracket (within a small char window — anything
// further is a different module).
//
// Each ChartDataPoint1D entry has:
//   yPercent : 0.319                                 // fraction
//   yFormattedValue.text: "31.9%"                    // pre-formatted
//   xLabel.text: "Greater São Paulo Area"            // demographic value
// ---------------------------------------------------------------------------

const VOYAGER_ENUM_TO_CATEGORY: Record<
  string,
  ParsedDemographicEntry['category']
> = {
  STRUCTURED_TITLE_OCCUPATION: 'job_title',
  OCCUPATION_SENIORITY: 'seniority',
  REGION_GEO: 'location',
  ORGANIZATION: 'company',
  INDUSTRY: 'industry',
  STAFF_COUNT_RANGE: 'company_size',
};

/**
 * Parse the demographic-detail page's embedded Voyager JSON. Operates on
 * the raw HTML response — internally HTML-unescapes the &quot;-style
 * entities so the JSON shape is readable. Returns ranked entries across
 * all categories the page surfaces.
 */
export function parseDemographicDetailHtml(
  html: string,
): ParsedDemographicEntry[] {
  // HTML-unescape so JSON quotes are real quotes. Fast string replace
  // covers the entities LinkedIn emits.
  const text = html
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

  const out: ParsedDemographicEntry[] = [];

  // Find each "dataPoints":[...] array that contains real entries. We
  // walk the bracket depth manually so nested arrays inside (e.g.
  // attributesV2:[]) don't confuse the boundary scan. Skips schema-
  // definition occurrences, which don't have ChartDataPoint1D shapes.
  const marker = '"dataPoints":[';
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(marker, pos);
    if (idx < 0) break;
    const arrStart = idx + marker.length - 1; // position of '['
    const arrEnd = scanMatchingBracket(text, arrStart);
    if (arrEnd < 0) break;
    const body = text.slice(arrStart + 1, arrEnd);
    pos = arrEnd + 1;

    // Real instance arrays contain "yPercent" and "xLabel" fields.
    if (!body.includes('yPercent') || !body.includes('xLabel')) continue;

    // The category enum follows the dataPoints array. Look ahead
    // ~1500 chars — comfortably past the BarChart wrapper but tight
    // enough to avoid pulling in the next module's category.
    const lookAhead = text.slice(arrEnd + 1, arrEnd + 1500);
    const catMatch = /"category":"([A-Z_0-9]+)"/.exec(lookAhead);
    if (!catMatch) continue;
    const category = VOYAGER_ENUM_TO_CATEGORY[catMatch[1]];
    if (!category) continue;

    // Extract entries. yPercent appears before xLabel inside each
    // ChartDataPoint1D; pair them with non-greedy `[\s\S]*?`.
    const entryRe =
      /"yPercent":([0-9.]+)[\s\S]*?"xLabel":\{[\s\S]*?"text":"([^"]+)"/g;
    let m: RegExpExecArray | null;
    let rank = 1;
    while ((m = entryRe.exec(body)) !== null) {
      const yPercent = parseFloat(m[1]);
      // Schema expects 0–100. Round to one decimal to match
      // yFormattedValue precision (LinkedIn shows e.g. 31.9%).
      const pct = Math.round(yPercent * 1000) / 10;
      const value = m[2];
      if (!value || !/[a-z0-9]/i.test(value)) continue;
      out.push({ category, value, pct, rank });
      rank++;
    }
  }
  return out;
}

/** Walk forward from `[` to its matching `]`, respecting JSON string
 *  literals (don't count brackets inside strings). */
function scanMatchingBracket(text: string, openIdx: number): number {
  if (text[openIdx] !== '[') return -1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

/**
 * LinkedIn rewrote the post-summary demographics block sometime before
 * 2026-05. The OLD layout (still in our test fixture) showed a category
 * label as a section header:
 *   `Location Greater Rio de Janeiro 32% ...`
 * The NEW layout shows the top entry per category with an English-prose
 * subtitle that identifies the category:
 *   `Greater São Paulo Area From this location 32%`
 *   `Senior With this experience level 29%`
 *   `IT Services and IT Consulting In this industry 19%`
 * No category-label headers visible. Only top-1 entry per category on
 * the post-summary page itself; the full top-N hides behind a "Show
 * all" link we don't follow yet.
 */
const SUBTITLE_TO_CATEGORY: Record<
  string,
  ParsedDemographicEntry['category']
> = {
  'From this location': 'location',
  'With this experience level': 'seniority',
  'In this industry': 'industry',
  'With this job title': 'job_title',
  'From this company': 'company',
  'At this company': 'company',
  'From companies of this size': 'company_size',
  'Of this company size': 'company_size',
};

const SUBTITLE_RE_SOURCE = Object.keys(SUBTITLE_TO_CATEGORY)
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const SECTION_HEADER_RE = /Post viewers demographics/;

function extractFromSubtitles(text: string): ParsedDemographicEntry[] {
  const headerMatch = SECTION_HEADER_RE.exec(text);
  if (!headerMatch) return [];
  // Skip past the header so it doesn't get captured as a value prefix
  // for the first entry.
  const sectionStart = headerMatch.index + headerMatch[0].length;
  const section = text.slice(sectionStart);

  // Pattern: VALUE (1+ non-% chars, non-greedy) + SUBTITLE + PCT.
  const pat = new RegExp(
    `([^%]+?)\\s+(${SUBTITLE_RE_SOURCE})\\s+(<\\s*1\\s*%|\\d+\\s*%)`,
    'g',
  );

  const out: ParsedDemographicEntry[] = [];
  const ranksByCategory = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = pat.exec(section)) !== null) {
    const value = m[1].trim();
    const subtitle = m[2];
    const pct = parsePctToken(m[3]);
    const category = SUBTITLE_TO_CATEGORY[subtitle];
    if (!category || !value || !/[a-z0-9]/i.test(value)) continue;
    const r = (ranksByCategory.get(category) ?? 0) + 1;
    ranksByCategory.set(category, r);
    out.push({ category, value, pct, rank: r });
  }
  return out;
}

/**
 * Find every category label with at least one (value, pct) pair following.
 * Returns demographic entries in the same shape the server schema expects.
 *
 * Tries the live (2026-05+) "VALUE SUBTITLE PCT" layout first; falls
 * back to the legacy "CATEGORY VALUE PCT" layout from the captured
 * fixture for backward compat with older snapshots.
 */
export function extractDemographics(text: string): ParsedDemographicEntry[] {
  if (isDemographicsRetentionLimited(text)) return [];

  const live = extractFromSubtitles(text);
  if (live.length > 0) return live;

  return extractFromCategoryLabels(text);
}

function extractFromCategoryLabels(
  text: string,
): ParsedDemographicEntry[] {
  // Find every (label, position) hit across all category names. Prefer
  // longer labels by sorting matches descending on label length when
  // they overlap (e.g. "Company size" vs "Company").
  const hits: Array<{ key: ParsedDemographicEntry['category']; pos: number; len: number }> = [];
  for (const cat of DEMO_CATEGORIES) {
    const re = new RegExp(`\\b${cat.label}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ key: cat.key, pos: m.index, len: cat.label.length });
    }
  }
  hits.sort((a, b) => a.pos - b.pos || b.len - a.len);

  const filtered: typeof hits = [];
  for (const h of hits) {
    const last = filtered[filtered.length - 1];
    if (last && h.pos < last.pos + last.len) continue;
    filtered.push(h);
  }

  const out: ParsedDemographicEntry[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const h = filtered[i];
    const next = filtered[i + 1];
    const sectionStart = h.pos + h.len;
    const sectionEnd = Math.min(
      next ? next.pos : text.length,
      sectionStart + 1500,
    );
    const section = text.slice(sectionStart, sectionEnd);

    let rank = 1;
    VALUE_PCT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VALUE_PCT_RE.exec(section)) !== null) {
      const value = m[1].trim();
      const pct = parsePctToken(m[2]);
      if (!/[a-z0-9]/i.test(value)) continue;
      out.push({ category: h.key, value, pct, rank });
      rank++;
      if (rank > 10) break;
    }
  }
  return out;
}
