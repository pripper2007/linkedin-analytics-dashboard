// Pure-text feature detector for LinkedIn post content.
//
// The browser extension doesn't compute these flags at capture time —
// it only sends the raw post_content. So we derive them here, both at
// ingest (route.ts) and in a backfill script that reprocesses every
// existing post from its stored content. Five of the six flags are
// content-only; `has_image` needs image metadata and is handled
// separately by callers (derived from posts.image_type).
//
// Rules kept deliberately narrow — false positives are worse than
// false negatives for a scoring system. Tune the regexes in one place.

export interface ContentFeatures {
  hasLink: boolean;
  hasEmoji: boolean;
  hasBulletPoints: boolean;
  hasQuestion: boolean;
  hasBoldUnicode: boolean;
}

// Any http(s) URL — LinkedIn always writes links in full form.
const LINK_RE = /https?:\/\/[^\s]+/i;

// Unicode extended pictographic class catches emoji / symbol fonts
// (🚀, 🤖, 💡, ⚡, ➡️, ✅, etc.) without matching bold-unicode letters.
const EMOJI_RE = /\p{Extended_Pictographic}/u;

// Bullet-like line prefix. Same vocabulary the classifier uses.
// Counts lines, not characters — one "-" in the middle of a sentence
// shouldn't make the post bullet-heavy.
const BULLET_LINE_RE = /^\s*(?:[-•*▪●◦▶→]|\d+[.)])\s+/;

// Mathematical Alphanumeric Symbols block — bold-styled unicode
// characters used on LinkedIn to fake text formatting
// (𝗤, 𝘂, 𝗮, etc. at U+1D400–U+1D7FF).
const BOLD_UNICODE_RE = /[\u{1D400}-\u{1D7FF}]/u;

export function detectFeatures(content: string): ContentFeatures {
  const text = content ?? '';

  const bulletLines = text
    .split(/\n/)
    .filter((line) => BULLET_LINE_RE.test(line)).length;

  return {
    hasLink: LINK_RE.test(text),
    hasEmoji: EMOJI_RE.test(text),
    hasBulletPoints: bulletLines >= 3,
    hasQuestion: text.includes('?'),
    hasBoldUnicode: BOLD_UNICODE_RE.test(text),
  };
}

// Derives has_image from the posts.image_type column. Returns null when
// the caller doesn't know (e.g. we never captured imageType for a post
// via the extension) so they can preserve whatever was there before.
export function hasImageFromType(imageType: string | null | undefined): boolean | null {
  if (imageType == null || imageType === '') return null;
  if (imageType === 'none' || imageType === 'no_image') return false;
  return true;
}

// Count how many of the 5 boolean flags are true — useful for
// feature_count aggregate column. Does not include hasImage since
// callers aggregate that separately (image detection lives outside).
export function countContentFeatures(f: ContentFeatures): number {
  return (
    Number(f.hasLink) +
    Number(f.hasEmoji) +
    Number(f.hasBulletPoints) +
    Number(f.hasQuestion) +
    Number(f.hasBoldUnicode)
  );
}

/**
 * Word + paragraph counts derived from raw content. The extension
 * doesn't send these (it has no domain-aware tokenizer), so the ingest
 * route + recompute script call this. Empty content returns zeroes.
 *
 * - words: tokens split on any whitespace (including non-breaking
 *   spaces and unicode separators). Punctuation stays attached.
 * - paragraphs: groups separated by one-or-more blank lines, with at
 *   least one non-whitespace character.
 */
export function countWordsAndParagraphs(content: string): {
  wordCount: number;
  paragraphCount: number;
} {
  const text = (content ?? '').trim();
  if (!text) return { wordCount: 0, paragraphCount: 0 };
  const words = text.split(/\s+/u).filter(Boolean);
  const paragraphs = text
    .split(/\n\s*\n+/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return {
    wordCount: words.length,
    paragraphCount: paragraphs.length,
  };
}
