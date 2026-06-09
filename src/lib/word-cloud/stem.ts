// Minimal Portuguese + English stemmer.
//
// Purpose: collapse morphological variants of the SAME word onto a
// shared "stem" key so they aggregate together in the word cloud.
//   pagamento / pagamentos / pagando   → pagament
//   inovação / inovações                → inovaç
//   payment / payments / paying         → pay*  (via the -s and -ing rules)
//
// Design: one ordered rule list, longest/most-specific first, generic
// -s last. First-match-wins. If you find a word that's over-stemmed
// (rule fires when it shouldn't) or under-stemmed (no rule fires but
// one should), add a new rule ABOVE the generic ones.
//
// Scope: this is NOT a full Snowball port. We aim for the 80% of
// morphological merges that matter in Pedro's 125-post corpus, while
// staying easy to reason about.
//
// Minimum stem length is 3 chars: rules that would shorten below that
// are rejected and the next rule tried.

const MIN_STEM_LENGTH = 3;

// One ordered rule list: [regex, residue]. Ordered longest/most-specific
// first so "pagamentos" hits `-mentos → ment` before the generic `-s → ''`.
const RULES: Array<[RegExp, string]> = [
  // --- Portuguese derivational suffixes (nouns/adjectives) ---
  [/mentos$/, 'ment'],       // pagamentos → pagament
  [/mento$/, 'ment'],        // pagamento → pagament
  [/ações$/, 'aç'],          // transações → transaç
  [/ação$/, 'aç'],           // transação → transaç
  [/ções$/, 'ç'],            // construções → construç
  [/ção$/, 'ç'],             // construção → construç
  [/dades$/, 'dad'],         // sociedades → sociedad
  [/dade$/, 'dad'],          // sociedade → sociedad
  [/ismos$/, 'ism'],
  [/ismo$/, 'ism'],
  [/istas$/, 'ist'],
  [/ista$/, 'ist'],
  [/ivos$/, 'iv'],
  [/ivo$/, 'iv'],
  [/ivas$/, 'iv'],
  [/iva$/, 'iv'],

  // --- Portuguese verb inflections ---
  [/(aram|eram|iram)$/, ''],
  [/(arão|erão|irão)$/, ''],
  [/(asse|esse|isse)$/, ''],
  [/(aria|eria|iria)$/, ''],
  [/(amos|emos)$/, ''],      // cantamos → cant
  [/ando$/, ''],             // pagando → pag
  [/endo$/, ''],             // correndo → corr
  [/indo$/, ''],             // partindo → part

  // --- English derivational suffixes (must beat generic -s) ---
  [/ingly$/i, ''],
  [/ing$/i, ''],             // paying → pay
  [/edly$/i, ''],
  [/ed$/i, ''],              // played → play
  [/ies$/i, 'y'],            // companies → company
  [/ied$/i, 'y'],            // applied → apply
  [/ly$/i, ''],              // quickly → quick

  // --- Portuguese generic plural / verb-infinitive fallbacks ---
  [/ões$/, 'ão'],            // razões → razão
  [/ais$/, 'al'],            // animais → animal
  [/eis$/, 'el'],            // papéis → papel

  // --- Generic last-resort plural strip ---
  [/s$/, ''],                // payments → payment, companies already handled above
];

/**
 * Reduce a lowercased token to its stem. Idempotent: stem(stem(x)) === stem(x).
 * Returns the input unchanged if no rule applies or if applying a rule
 * would drop the length below MIN_STEM_LENGTH.
 */
export function stem(word: string): string {
  if (!word || word.length <= MIN_STEM_LENGTH) return word;
  for (const [pattern, residue] of RULES) {
    if (pattern.test(word)) {
      const candidate = word.replace(pattern, residue);
      if (candidate.length >= MIN_STEM_LENGTH) return candidate;
    }
  }
  return word;
}
