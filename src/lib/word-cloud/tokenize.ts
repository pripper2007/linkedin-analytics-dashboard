// Text → word tokens, tuned for LinkedIn post bodies.
//
// Pipeline (applied in order):
//   1. Normalize Unicode math-alphanumeric blocks back to plain Latin.
//      Pedro's posts lean heavily on characters like 𝗢, 𝗽, 𝗹, 𝗮, which
//      a naive tokenizer would treat as distinct from their ASCII
//      counterparts (𝗢𝗹𝗮 ≠ ola). NFKC handles this natively via
//      compatibility decomposition.
//   2. Strip URLs, @mentions, and # prefixes on hashtags (the hashtag
//      word itself is kept — "#Bemobi" → "Bemobi").
//   3. Remove all chars that aren't Unicode letters, combining marks,
//      or whitespace. This preserves Portuguese accents (é, ã, ç).
//   4. Lowercase, split on whitespace.
//   5. Drop tokens shorter than 3 characters and pure stopwords.
//   6. Drop tokens that look like person names — via the FIRST_NAMES
//      stoplist + the Title-Case-pair heuristic (see names.ts).

import { STOPWORDS } from './stopwords';
import { FIRST_NAMES, extractNameTokens } from './names';

const MIN_LENGTH = 3;
const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /@[\p{L}\p{N}_-]+/gu;
const HASH_PREFIX_RE = /#(\p{L})/gu;
// Anything that is not a Unicode letter, combining mark, or whitespace.
const PUNCT_RE = /[^\p{L}\p{M}\s]+/gu;

export function tokenize(body: string): string[] {
  if (!body) return [];

  // Per-post probable names, from the Title-Case-pair heuristic. Runs on
  // the raw body (before lowercasing) because the heuristic needs the
  // original casing. We union this with the global FIRST_NAMES set.
  const perPostNames = extractNameTokens(body);

  const cleaned = body
    .normalize('NFKC')
    .replace(URL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(HASH_PREFIX_RE, '$1') // drop the '#' but keep the word
    .replace(PUNCT_RE, ' ')
    .toLowerCase();

  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (raw.length < MIN_LENGTH) continue;
    if (STOPWORDS.has(raw)) continue;
    if (FIRST_NAMES.has(raw)) continue;
    if (perPostNames.has(raw)) continue;
    tokens.push(raw);
  }
  return tokens;
}
