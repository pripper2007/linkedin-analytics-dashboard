// Pull the most-mentioned people / companies from Pedro's comment text.
//
// We don't have author metadata for the posts Pedro reacts to (the
// LinkedIn export only ships activity URNs without author info), so we
// approximate "who you engage with" by extracting capitalized name-like
// sequences from the comment bodies themselves. It's not perfect — it
// misses people Pedro didn't address by name and over-counts when one
// person is referenced multiple times in the same comment — but it's
// a strong proxy in practice because comments on LinkedIn typically
// open with the addressee's name ("Parabéns Gian Lucchesi !").
//
// Matching rules:
//   1. A "name candidate" is 2–4 consecutive capitalized tokens, with
//      Portuguese name connectors ("de", "da", "dos", etc.) allowed
//      between them in lowercase. Single capitalized tokens are too
//      noisy (sentence starts, "Olá", brand mentions).
//   2. The candidate is dropped if it matches a denylist of frequent
//      false positives (common bigrams, brand names, place names that
//      aren't people).
//   3. Counts dedupe per comment — if Pedro mentions someone twice in
//      the same comment, that's still one engagement signal.

const NAME_REGEX =
  /\b[A-ZÁÉÍÓÚÂÊÔÃÕÇÜ][a-záéíóúâêôãõçüçñ]+(?:\s+(?:de|da|do|dos|das|del|du|d'|von|van|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇÜ][a-záéíóúâêôãõçü]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇÜ][a-záéíóúâêôãõçü]+){1,3}\b/g;

// Bigrams / trigrams that match the regex but aren't people. Add as
// they show up — the page surfaces the top-N so noisy entries are
// obvious.
const DENY = new Set<string>([
  'Open Finance',
  'Smart Checkout',
  'Big Techs',
  'Big Tech',
  'Inteligência Artificial',
  'Internet das Coisas',
  'Black Friday',
  'Dia das Mães',
  'Dia dos Pais',
  'Dia das Crianças',
  'Conta de Águas',
  'Conta de Luz',
  'São Paulo',
  'Rio de Janeiro',
  'Minas Gerais',
  'Belo Horizonte',
  'Espírito Santo',
  'Mato Grosso',
  'Boa Tarde',
  'Bom Dia',
  'Boa Noite',
  'Muito Obrigado',
  'Apple Pay',
  'Google Pay',
  'Tim Brasil',
  'Vivo Telefônica',
  'Claro Brasil',
  'América Latina',
  'Estados Unidos',
  'Banco Central',
  'Receita Federal',
  // months/days starting capitalized in PT
  'Black Week',
]);

export interface NameCount {
  name: string;
  count: number;
}

/**
 * Extract top mentioned names from a list of comment messages.
 * Returns an array sorted descending by count, capped at `topN`.
 */
export function extractTopMentions(
  messages: string[],
  topN: number = 15,
): NameCount[] {
  const counts = new Map<string, number>();

  for (const msg of messages) {
    if (!msg) continue;
    // Per-comment dedupe — one mention per comment, regardless of how
    // many times the name appears in the body.
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    NAME_REGEX.lastIndex = 0;
    while ((m = NAME_REGEX.exec(msg)) !== null) {
      const candidate = m[0].trim();
      if (DENY.has(candidate)) continue;
      // Reject obviously non-name patterns (e.g. starts with a non-name
      // common word). Cheap heuristic; the real signal is the regex.
      seen.add(candidate);
    }
    for (const name of seen) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, topN);
}
