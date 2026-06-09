// Person-name detection for the word cloud.
//
// Two complementary layers:
//
//   1. FIRST_NAMES: a curated set of common Portuguese + English first
//      names. Any single-word lowercase match is stripped. Names are the
//      single biggest source of noise in Pedro's LinkedIn posts because
//      he @-mentions collaborators and tags colleagues in announcements.
//
//   2. Title-Case heuristic (see extractNameTokens): runs on the ORIGINAL
//      (not-yet-lowercased) text and flags two consecutive Title-Cased
//      tokens as "probably a name" (Pedro Ripper, Fernando Fontes).
//      The list is unioned with FIRST_NAMES at the call site.
//
// False positives are controlled by the BUSINESS_ALLOWLIST in allowlist.ts:
// terms like "Open Finance" or "Central Bank" are whitelisted so they
// survive the heuristic even though they match the "two capitalized words"
// pattern.

import { BUSINESS_ALLOWLIST } from './allowlist';

// Curated list of the most common Portuguese + English first names.
// Lowercased; matched against the lowercased token stream.
// Sources: IBGE most-common BR given names + US SSA top names, trimmed
// down to entries likely to appear in Pedro's network.
const FIRST_NAMES_ARR = [
  // Portuguese-Brazilian — very common firsts
  'pedro', 'paulo', 'marcos', 'marco', 'marcio', 'márcio', 'mateus', 'matheus',
  'lucas', 'lucas', 'gustavo', 'rafael', 'rodrigo', 'roberto', 'ricardo', 'rogerio', 'rogério',
  'fernando', 'felipe', 'fabio', 'fábio', 'flavio', 'flávio', 'fabiano',
  'joão', 'joao', 'jose', 'josé', 'julio', 'júlio', 'joaquim',
  'andre', 'andré', 'antonio', 'antônio', 'alexandre', 'adriano', 'alvaro', 'álvaro',
  'carlos', 'caio', 'cesar', 'césar', 'cristiano', 'claudio', 'cláudio',
  'daniel', 'diego', 'douglas', 'danilo',
  'eduardo', 'eric', 'erick',
  'gabriel', 'guilherme', 'giovanni',
  'henrique', 'hugo', 'hector', 'heitor',
  'igor', 'ivan', 'ivo',
  'leandro', 'leonardo', 'leo', 'luis', 'luiz', 'luísa', 'luisa',
  'miguel', 'murilo', 'maurício', 'mauricio',
  'nelson', 'nicolas', 'nicolau',
  'otavio', 'otávio', 'oscar',
  'renato', 'renan', 'romulo', 'rômulo', 'raul',
  'sergio', 'sérgio', 'samuel', 'saulo',
  'thiago', 'tiago', 'tomas', 'tomás',
  'vinicius', 'vinícius', 'victor', 'vitor',
  'wagner', 'wesley', 'walter',
  // Portuguese feminine firsts
  'ana', 'alice', 'amanda', 'adriana', 'aline',
  'beatriz', 'bia', 'bianca', 'barbara', 'bárbara',
  'camila', 'carla', 'carolina', 'cristina', 'catarina', 'clara', 'cecilia', 'cecília',
  'debora', 'débora', 'daniela', 'daniele',
  'eliane', 'eliana', 'elisa', 'erica', 'érica', 'eduarda',
  'fernanda', 'flavia', 'flávia',
  'gabriela', 'giovanna',
  'helena', 'helen',
  'isabela', 'isabella', 'isabel',
  'juliana', 'julia', 'júlia',
  'karina', 'katia', 'kátia',
  'larissa', 'laura', 'leticia', 'letícia', 'luana', 'lucia', 'lúcia',
  'marcela', 'maria', 'mariana', 'marina', 'monica', 'mônica', 'manuela',
  'natalia', 'natália', 'nathalia',
  'patricia', 'patrícia', 'paula',
  'raquel', 'renata', 'rita', 'roberta',
  'sandra', 'sarah', 'sara', 'silvia', 'sílvia', 'sofia',
  'tatiana', 'thais', 'thaís', 'tereza', 'teresa',
  'valeria', 'valéria', 'vanessa', 'vitoria', 'vitória',
  // English firsts commonly seen in international business posts
  'alex', 'andrew', 'adam', 'aaron', 'anthony', 'alan',
  'ben', 'bob', 'brian', 'bruce',
  'chris', 'charlie', 'craig', 'colin',
  'dave', 'david', 'dan', 'dennis',
  'eric', 'edward', 'evan',
  'frank', 'fred',
  'george', 'greg',
  'harry', 'harold',
  'ian',
  'jack', 'jason', 'jeff', 'jim', 'john', 'joe', 'joseph', 'jonathan', 'justin',
  'kevin', 'kyle',
  'larry',
  'mark', 'matt', 'matthew', 'michael', 'mike', 'mitchell',
  'nathan', 'nick', 'nicolas',
  'peter', 'patrick', 'phil',
  'robert', 'rob', 'ryan', 'richard',
  'scott', 'sean', 'steve', 'stephen', 'simon',
  'tim', 'timothy', 'todd', 'tom', 'travis',
  // English feminine firsts
  'alice', 'amy', 'anna', 'angela', 'amanda',
  'beth', 'barbara',
  'carol', 'claire', 'catherine', 'cindy',
  'diane', 'deborah',
  'emily', 'emma', 'ellen',
  'grace',
  'heather', 'helen',
  'jane', 'jennifer', 'jessica', 'judy', 'julie',
  'karen', 'kate', 'katherine',
  'linda', 'laura', 'lisa',
  'margaret', 'mary', 'michelle',
  'nancy', 'nicole',
  'patricia', 'paula',
  'rachel', 'rebecca', 'rose',
  'samantha', 'sarah', 'susan',
  'victoria',
];

export const FIRST_NAMES: ReadonlySet<string> = new Set(
  FIRST_NAMES_ARR.map((s) => s.toLowerCase()),
);

/**
 * Extract the lowercase tokens that are likely part of a person's name,
 * based on two-consecutive-Title-Case detection on the RAW body.
 *
 * Example:
 *   "cheers to Marcio Kroehn and the team"
 *     → ['marcio', 'kroehn']
 *
 * Why this works: LinkedIn post authors write names in Title Case ("Ana
 * Paula"), and the post body is otherwise mostly sentence-case or all
 * unicode-math-bold (which NFKC normalizes back to the same case class).
 * Two Title-Cased tokens back-to-back is almost always a person.
 *
 * Limits: catches doesn't catch single-name references ("cheers Pedro") —
 * those rely on the FIRST_NAMES list instead. Also doesn't handle name
 * particles like "de", "da" between given and surname ("Ana de Souza") —
 * the particle breaks the adjacency, so we'd catch "Ana" via FIRST_NAMES
 * and "Souza" would survive. Good enough for v1.
 *
 * The returned tokens are lowercased to match what the tokenizer will
 * produce, and filtered against BUSINESS_ALLOWLIST (so "Open Finance"
 * and friends aren't mistakenly flagged as names).
 */
export function extractNameTokens(rawBody: string): Set<string> {
  const out = new Set<string>();
  if (!rawBody) return out;

  // Work on the original-case text AFTER Unicode math-bold normalization
  // so "𝗣𝗲𝗱𝗿𝗼" collapses to "Pedro" and the capitalization is visible.
  const normalized = rawBody.normalize('NFKC');

  // Tokenize on whitespace/punctuation, keeping the raw surface form.
  // We need Title-Case detection, so we cannot pre-lowercase.
  const tokens: string[] = [];
  const PUNCT_RE = /[^\p{L}\p{M}\s]+/gu;
  const cleaned = normalized.replace(PUNCT_RE, ' ');
  for (const t of cleaned.split(/\s+/)) {
    if (t) tokens.push(t);
  }

  // Two-pass scan.
  //
  // Pass 1: find all pairs that match the business allowlist and mark
  // both words as "protected" — they should never be flagged as names,
  // even if they happen to appear in another Title-Case pair (e.g.
  // "The Central Bank" → pair "The Central" would otherwise flag
  // "Central" before we ever see "Central Bank").
  const protectedWords = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (!isTitleCase(a) || !isTitleCase(b)) continue;
    const pairLower = `${a} ${b}`.toLowerCase();
    if (BUSINESS_ALLOWLIST.has(pairLower)) {
      protectedWords.add(a.toLowerCase());
      protectedWords.add(b.toLowerCase());
    }
  }

  // Pass 2: flag Title-Case pairs where neither word is protected.
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (!isTitleCase(a) || !isTitleCase(b)) continue;
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    if (protectedWords.has(lowerA) || protectedWords.has(lowerB)) continue;
    out.add(lowerA);
    out.add(lowerB);
  }
  return out;
}

/** True when a string starts with an uppercase letter followed by lowercase. */
function isTitleCase(s: string): boolean {
  if (s.length < 2) return false;
  const first = s.charAt(0);
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return false;
  const rest = s.slice(1);
  return rest === rest.toLowerCase();
}
