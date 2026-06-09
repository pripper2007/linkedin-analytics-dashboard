// Normalized content "fingerprint" used to decide whether two posts are
// the same logical post even when their LinkedIn URNs differ.
//
// Motivation: the LinkedIn "Shares.csv" data export wraps multi-line
// post bodies in outer quotes and doubles any internal quotes, e.g.
//     "He said, "hello"" → "He said, ""hello"""
// Meanwhile the seed JSON stores the raw body without those artifacts.
// Comparing the two strings directly never matches, but comparing their
// whitespace-and-quote-stripped prefixes does.
//
// Tuning: MATCH_PREFIX_CHARS = 30 is chosen so posts shorter than that
// are NEVER matched (the fingerprint comes back null) — avoids false
// positives on very short posts. Why 30 and not 40: we observed a real
// case where a user edited a post and re-published with a trailing emoji
// appended, making the 40th character diverge (𝘀. vs 𝘀🤖) while the first
// 39 chars were identical. 30 chars sits comfortably inside the common
// headline/opening region of Pedro's posts. The "skip classes with
// multiple authoritative members" rule in the reconciliation script is
// the safety net for any genuine false positives.
export const MATCH_PREFIX_CHARS = 30;

const STRIP_RE = /[\s"'“”‘’]+/gu;

/**
 * Returns a normalized fingerprint for the post body, or null if the
 * post is too short to fingerprint reliably. A short post falling back
 * to null means the caller should rely on the timestamp-based dedup
 * alone (the legacy behavior).
 */
export function contentFingerprint(body: string): string | null {
  if (!body) return null;
  const stripped = body.replace(STRIP_RE, '');
  if (stripped.length < MATCH_PREFIX_CHARS) return null;
  return stripped.slice(0, MATCH_PREFIX_CHARS);
}
