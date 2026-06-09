// Business / domain-specific terms that happen to be Title-Cased in
// Pedro's posts but should NOT be filtered as person names.
//
// Each entry is the lowercase form of the two-word phrase. The Title-
// Case name heuristic in names.ts checks `BUSINESS_ALLOWLIST.has(lower)`
// before flagging a pair as a name.
//
// Add to this list as false positives show up. Keep entries in the
// lowercase bigram format ("open finance", not "Open Finance").

export const BUSINESS_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Brazilian payments / fintech
  'open finance',
  'open banking',
  'central bank',
  'banco central',
  'real digital',
  'mercado pago',
  'banco inter',
  // Tech terms commonly Title-Cased
  'artificial intelligence',
  'machine learning',
  'deep learning',
  'large language',
  'language model',
  'neural network',
  'data science',
  'cloud computing',
  'open source',
  'open standard',
  // Organization-like phrasings that aren't people
  'new york',
  'são paulo',
  'sao paulo',
  'rio de',
  'de janeiro',
  'latin america',
  'latin américa',
  'american express',
  // Programs / movements
  'venture capital',
  'private equity',
  'public offering',
  'series a',
  'series b',
  'series c',
]);
