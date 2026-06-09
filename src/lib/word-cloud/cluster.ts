// LLM-powered semantic clustering for the Idea Cloud.
//
// Input: a list of stemmed words with their frequency and a few surface-
// form examples. Output: an array of clusters, each with a short
// semantic label and the list of member stems.
//
// The stems aren't ideas yet. "pagament" and "pix" and "transfer" all
// live on the same theme (Brazilian payments) but a pure-stem merge
// won't collapse them. Claude does the semantic grouping that stemming
// can't reach.
//
// Model: claude-opus-4-7 with adaptive thinking + effort:low, since this
// is a simple classification task. Strict JSON via Zod structured output.
// Prompt caching on the system prompt — same instructions ship on every
// call, the word list changes.
//
// Failure mode: if ANTHROPIC_API_KEY isn't set, or the API call fails,
// or the response can't be parsed, we return null and the caller falls
// back to stem-only display.

import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from '../ai/anthropic';

const MODEL = 'claude-opus-4-7';

// Input to the clusterer: one entry per stem, sorted highest-count first.
// `examples` are 1-3 surface forms of that stem seen in the corpus —
// useful for Claude to understand the domain (e.g. the stem "ment"
// examples might be ["pagamento", "pagamentos"]).
export interface ClusterInput {
  stem: string;
  count: number;
  examples: string[];
}

// Output shape. `label` is the 1-3 word semantic name Claude picked
// for the cluster; `members` are the stems it grouped together.
export interface ClusterOutput {
  label: string;
  members: string[];
}

// Wrapping the cluster + exclusion lists in a single object so the
// caller can honor the exclusion. Earlier versions only returned the
// clusters and silently dropped the exclusion list — that meant any
// stem the LLM rejected as filler still leaked into the standalone
// fallback path in aggregate.ts.
export interface ClusterResult {
  clusters: ClusterOutput[];
  excluded: string[];
}

// Zod schema for the strict JSON output we require from Claude.
// Matches Anthropic's structured-outputs subset (no numerical or
// string-length constraints, `additionalProperties: false` on every
// object — enforced by zodOutputFormat).
const responseSchema = z.object({
  clusters: z.array(
    z.object({
      label: z
        .string()
        .describe('Short 1-3 word semantic label for this cluster'),
      members: z
        .array(z.string())
        .describe('Stems belonging to this cluster'),
    }),
  ),
  excluded: z
    .array(z.string())
    .describe('Stems to exclude (names, places, brand mentions that slipped past the filter)'),
});

// System prompt — STABLE across calls, so prompt caching activates.
// Keep this precisely worded; it's the difference between "fintech /
// pagamentos / pix" returning 3 clusters (bad) vs 1 cluster "Brazilian
// payments" (good).
const SYSTEM_PROMPT = `You are helping build an IDEA CLOUD from a LinkedIn author's posts. The author writes primarily in Portuguese about fintech, payments, AI, and business strategy.

You will receive a list of WORD STEMS with their frequency counts and 1-3 surface-form examples each. The stems come from tokenized, stemmed post bodies — they may be partial words (e.g. "pagament" for "pagamento/pagamentos", "aç" for "ação/ações").

GOAL: produce a clean, curated map of IDEAS AND CONCEPTS. Quality over quantity. Fewer, meaningful clusters is better than many clusters with noise. If in doubt about a stem, exclude it.

Your job:

1. EXCLUDE aggressively. Put the following in the "excluded" list — these are NOT ideas:
   - Person names, surnames, or name fragments that slipped past the filter
   - Geographic place names, cities, countries
   - Specific brand or product names (unless they ARE the idea — "pix" is a payment method and concept)
   - PT verbs / discourse fillers: "manter", "tenho", "tenha", "tenor", "aposta", "aposto", "fim", "final", "num", "dele", "dela", "dessa", "desse", "mesma", "mesmo", "quero", "quem", "você", "agente", "gente", "real", "nova", "novo", "ponto", "ano", "anos", "dia", "hoje", "ontem", "agora", "ainda", "depois", "antes", "todo", "toda", "cada", "qualquer", "muito", "pouco", "tanto", "tão", "também", "apenas", "só", "ser", "estar", "ter", "fazer", "ir", "vir", "ver", "saber", "dar", "pegar", "deixar", "ficar", "parecer", "achar", "acontecer", "passar"
   - Older filler list: "desde", "confira", "parece", "acontece", "deixa", "conversa", "foco", "próximo", "último", "relevante", "simples", "completo", "manter", "saúde" (when used as wellness filler, not health-tech), "fim", "final", "real" (when used as "really" filler, not "real-time")
   - Time / magnitude references: "tempo", "momento", "semana", "mês", "ano", "crescendo", "primeiros", "últimos", "milhões", "números", etc.
   - Generic nouns used as filler: "pessoas", "gente", "visão", "artigo", "post", "forma", "caso", "padrão", "prática", "conta" (when not banking/account context), "modelo" (when not ML model), "experiência" (only keep if clearly UX/customer experience cluster)
   - Vague adjectives: "algumas", "muitas", "maiores", "menores", "atual", "diferente"
   - Single-letter or 2-3 letter stems that are likely word fragments rather than concepts (e.g. "ad", "us", "ev", "io")
   - Words that don't clearly represent a domain concept, theme, product, strategy, or idea
   - When in doubt: EXCLUDE. The user has explicitly said "fewer, sharper words" beats "many words with clutter".

2. CLUSTER the REMAINING stems by SEMANTIC MEANING into 6-15 groups. Each cluster must represent ONE CONCRETE, NAMEABLE IDEA — a theme, domain, product, strategy, technology, or recurring topic.
   - Good clusters: "Brazilian payments", "AI agents", "Customer experience", "Open finance", "Business strategy", "Banking regulation"
   - Bad clusters (DO NOT CREATE THESE): "Filler words", "Time periods", "Connectives", "Common nouns", "Descriptors", "Various topics", "Miscellaneous", "General concepts"
   - If a group of stems would only fit a generic/filler label, PUT THEM IN THE EXCLUDED LIST instead.

3. CLUSTER LABEL RULES:
   - 1-3 words, in the dominant language of the cluster's members (PT or EN)
   - Describes the IDEA, not the words ("AI / agents" ✓, "inteligência ia agent" ✗)
   - NEVER label a cluster "Filler words", "Time periods", "Connectives", or any generic catch-all. A cluster that would need such a label must not exist — excluded instead.

4. A stem that doesn't fit any concrete-idea cluster MUST go in the excluded list, not into a catch-all cluster. We'd rather have 8 sharp clusters than 15 clusters including 2 noisy ones.

5. Fewer clusters, larger and sharper, beats more clusters that are thin. A cluster of size 1 is only acceptable for a truly standalone concept worth seeing on its own (e.g. "Pix" or "LLMs" alone).

Return strict JSON matching the provided schema.`;

// Post-filter: reject any cluster whose label matches one of these
// meta/catch-all patterns. This is a defense-in-depth backstop on top
// of the prompt's instructions — even a well-prompted model will
// occasionally emit a "Filler words" cluster, and we'd rather drop it
// silently than show it in the UI.
const GENERIC_LABEL_RE =
  /\b(filler|connectiv|discourse|generic|miscellaneous|misc\.?|various|common|general|time period|temporal|descriptor|qualifier|modifier|stopword)\b/i;

// In-memory cache — key is a hash of the input stems + counts, value is
// the clustering result. This module lives on the server; on Vercel's
// Fluid Compute instances persist across requests, so repeat renders
// within the same window hit the cache. Cache-miss cost is one API
// call; that's acceptable given the ~1-3 s latency and <$0.01 per call
// at claude-opus-4-7 pricing for this payload size.
const cache = new Map<string, ClusterResult>();
const CACHE_MAX = 32;

// Bumped whenever the system prompt changes semantically so stale
// clusterings from a previous prompt don't get served.
const PROMPT_VERSION = 'v3-honor-excluded-2026-05-02';

function cacheKey(input: ClusterInput[]): string {
  // Deterministic stringification: sort by stem so re-ordering doesn't
  // invalidate. Prefix with the prompt version so a prompt change
  // automatically invalidates old entries.
  const parts = [...input]
    .sort((a, b) => a.stem.localeCompare(b.stem))
    .map((i) => `${i.stem}:${i.count}`);
  return `${PROMPT_VERSION}|${parts.join('|')}`;
}

/**
 * Cluster word stems by semantic meaning using Claude.
 *
 * Returns null when:
 *   - ANTHROPIC_API_KEY is not configured (local dev without a key)
 *   - The API call fails (network, 5xx, rate limit)
 *   - The response can't be parsed against our schema
 *
 * The caller should fall back to stem-only rendering in any null case.
 */
export async function clusterWords(
  input: ClusterInput[],
): Promise<ClusterResult | null> {
  if (input.length === 0) return { clusters: [], excluded: [] };

  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached) return cached;

  const client = getAnthropic();
  if (!client) return null;

  try {
    // `messages.parse()` validates the response against our Zod schema.
    // cache_control on the system prompt activates prompt caching.
    const { zodOutputFormat } = await import(
      '@anthropic-ai/sdk/helpers/zod'
    );
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        format: zodOutputFormat(responseSchema),
        effort: 'low',
      },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Here are the word stems to cluster:\n\n${JSON.stringify(input, null, 2)}`,
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) return null;

    // Backstop filter: drop any cluster with a generic/meta label even
    // if the model emitted it. See GENERIC_LABEL_RE above. Members of
    // dropped clusters get added to `excluded` so the caller filters
    // them out of the standalone fallback path too.
    const droppedClusters = parsed.clusters.filter((c) =>
      GENERIC_LABEL_RE.test(c.label),
    );
    const cleaned = parsed.clusters.filter(
      (c) => !GENERIC_LABEL_RE.test(c.label),
    );
    if (droppedClusters.length > 0) {
      console.log(
        '[cluster] dropped generic clusters:',
        droppedClusters.map((c) => c.label).join(', '),
      );
    }
    const excluded = [
      ...parsed.excluded,
      ...droppedClusters.flatMap((c) => c.members),
    ];

    const result: ClusterResult = { clusters: cleaned, excluded };

    // Record the result. Evict oldest if over capacity.
    if (cache.size >= CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, result);
    return result;
  } catch (err) {
    // Log but don't throw — fall back to stem-only path.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cluster] Claude call failed:', msg);
    if (err instanceof Anthropic.APIError) {
      console.error('[cluster] status:', err.status);
    }
    return null;
  }
}

// Exposed only for tests.
export const __internals__ = { SYSTEM_PROMPT, responseSchema, cacheKey, cache };
