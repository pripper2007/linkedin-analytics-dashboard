// Keyword-based classifier for LinkedIn posts.
//
// Returns { topic, style } for a given post_content string.
// Rules are intentionally transparent and tunable — this isn't meant
// to be perfect; it's meant to be good enough for analytical
// aggregation and easy to iterate on.
//
// Vocabulary matches what already exists in the DB (see
// scripts/inspect-classifications.ts output at time of writing):
//
//   Topics : 'Payments/Fintech' | 'AI/Technology' | null
//   Styles : 'Informational' | 'Personal narrative'
//          | 'Structured/Lists' | 'Announcement' | null
//
// null = "no strong signal for this post, leave unclassified".
// The dashboard already falls back to 'General' / 'Unclassified' at
// display time, and this way a future re-run can fill in newly-
// matching posts without clobbering manual corrections (we never
// overwrite non-null values — see backfill script).

export type Topic = 'Payments/Fintech' | 'AI/Technology' | null;
export type Style =
  | 'Informational'
  | 'Personal narrative'
  | 'Structured/Lists'
  | 'Announcement'
  | null;

export interface Classification {
  topic: Topic;
  style: Style;
}

// ---------------------------------------------------------------------------
// Topic rules — checked in order, first match wins.
// Regexes are case-insensitive and cover both English and Portuguese
// variants Pedro's content mixes. \b word boundaries avoid matching
// inside unrelated words (e.g. "AI" inside "MAIN").
// ---------------------------------------------------------------------------

const TOPIC_RULES: Array<{ topic: NonNullable<Topic>; pattern: RegExp }> = [
  {
    topic: 'Payments/Fintech',
    // pag\w* catches Portuguese verb forms (pagamos, pagou, pagando, pagar,
    // paga, pagam, ...) plus nouns (pagamento, pagamentos, pagador, pagante).
    // Accented variants like "página" (= "page") aren't matched because
    // their second char is "á" not "a" — the regex stays letter-literal.
    pattern:
      /\b(pix|pag(?:a|o|ar|ou|ando|am|amos|amento|amentos|uei|ador(?:es)?|ante(?:s)?|áveis?|[aá]vel)|fintech|psp|cart[aã]o|cr[eé]dito|banco|banking|banco\s*central|bcb|mercado\s*pago|nubank|ita[uú]|bradesco|santander|caixa|cbdc|real\s*digital|drex|open\s*banking|open\s*finance|transa[cç][aã]o|remessa|meios\s*de\s*pagamento|bemobi\s*pay|boleto|tef|adquirente|maquininha|bnpl|buy\s*now\s*pay\s*later)\b/i,
  },
  {
    topic: 'AI/Technology',
    pattern:
      /\b(ia\b|a\.?i\.?\b|llm|llms|gpt|chatgpt|claude|anthropic|openai|gemini|mistral|agente|agentes|cursor|copilot|modelo|modelos|transformer|machine\s*learning|deep\s*learning|neural|rag|embedding|mcp|inteligência\s*artificial|intelig[eê]ncia|devtools?|sdk|api|vibe\s*coding|p-?doom|t-?doom)\b/i,
  },
];

export function classifyTopic(content: string): Topic {
  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(content)) return rule.topic;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Style rules — also first-match-wins, but ordered from most specific
// to most general.
// ---------------------------------------------------------------------------

// `lan[cç]ament\w*` catches Portuguese forms with or without "o"/"os".
// `anunci\w*` catches anunciando, anunciei, anunciou, anúncio, anúncios
// (the trailing \w* avoids the \b-mid-word problem that tripped earlier).
const ANNOUNCEMENT_PATTERN =
  /\b(announc\w*|lan[cç]ament\w*|launch\w*|anunci\w*|apresent(?:o|amos|ando)|introduc\w*|introduzindo|new\s+(?:product|feature|release)|novo\s+(?:produto|recurso|lan[cç]amento)|we('re|\s+are)\s+(?:launching|announcing|shipping))\b/i;

// Post starts with a first-person self-referential signal within the
// first ~160 characters. Captures both Portuguese and English narratives.
const PERSONAL_NARRATIVE_START =
  /^[^.!?]{0,160}\b(eu |comigo\b|hoje (eu|vou|estou)|na semana passada|esta semana|this (morning|week|month)|today i|last week|i (just|recently|spent|was|started|shipped|learned|decided|finished|remember)|my (team|story|view|take|thoughts?|experience))\b/i;

// Bullet / structured indicators: three or more lines starting with a
// bullet-like prefix, or a numbered-list pattern.
function isStructured(content: string): boolean {
  const bulletLines = content
    .split(/\n/)
    .filter((line) => /^\s*(?:[-•*▪●◦▶→]|\d+[.)])\s+/.test(line)).length;
  return bulletLines >= 3;
}

export function classifyStyle(content: string): Style {
  if (isStructured(content)) return 'Structured/Lists';
  if (ANNOUNCEMENT_PATTERN.test(content)) return 'Announcement';
  if (PERSONAL_NARRATIVE_START.test(content)) return 'Personal narrative';
  // If the post has any content at all, default to Informational.
  // Returning null only for empty / whitespace-only posts.
  return content.trim() ? 'Informational' : null;
}

// ---------------------------------------------------------------------------
// Combined entry point. Empty content returns both null.
// ---------------------------------------------------------------------------
export function classifyPost(content: string): Classification {
  if (!content || !content.trim()) return { topic: null, style: null };
  return {
    topic: classifyTopic(content),
    style: classifyStyle(content),
  };
}
