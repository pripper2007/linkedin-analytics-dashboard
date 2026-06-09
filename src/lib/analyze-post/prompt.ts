// Composes the user-message body sent to Claude for post analysis.
// The system prompt is the skill file (loaded separately by the route).
// Pure function — no DB, no network — so it's easy to snapshot-test.

import type { AnalysisContext } from './build-context';

// ===========================================================================
// OUTPUT LANGUAGE & SECTION HEADERS — customize for your own language.
// The critique is returned as four markdown sections; the parser
// (schema.ts) splits on exactly these headers via ANALYSIS_SECTION_HEADERS,
// so this block is the single source of truth. Translate these headers AND
// OUTPUT_FORMAT_INSTRUCTIONS below to change the critique's language.
// Ships in Brazilian Portuguese (the author's posting language).
// ===========================================================================
const SECTION_HEADERS = [
  'O que funcionou',
  'O que pode melhorar',
  'Sugestões de reescrita',
  'Lição para guardar',
] as const;

export const ANALYSIS_SECTION_HEADERS = SECTION_HEADERS;

/** Output format spec — duplicated in the prompt and the parser so
 *  there's a single place to evolve them together. */
export const OUTPUT_FORMAT_INSTRUCTIONS = `Responda em português com EXATAMENTE quatro seções markdown, nesta ordem, cada uma com 2 a 5 frases. Use os títulos abaixo literalmente, com dois sinais # e o texto exato:

## ${SECTION_HEADERS[0]}
## ${SECTION_HEADERS[1]}
## ${SECTION_HEADERS[2]}
## ${SECTION_HEADERS[3]}

Não inclua nenhum texto antes da primeira seção nem depois da última. Não adicione seções extras.`;

function fmtBool(b: boolean): string {
  return b ? 'sim' : 'não';
}

export function composeAnalysisUserMessage(ctx: AnalysisContext): string {
  const { post, poolBaseline, percentiles, cohort } = ctx;
  const cohortLine = cohort
    ? `Entre os ${cohort.size} posts seus que compartilham este perfil (${cohort.description}), este teve ${cohort.impressionsRatio.toFixed(2)}× a mediana do grupo (mediana: ${cohort.medianImpressions.toLocaleString('pt-BR')} impressões).`
    : `Não há um grupo de comparação grande o suficiente (>=3 posts com o mesmo tema + mesmas características visuais).`;

  return `Analise este post.

POST:
"""
${post.post_content}
"""

DATA: ${post.post_date}  TEMA: ${post.topic}  ESTILO: ${post.style}

MÉTRICAS DESTE POST:
- Impressões: ${post.impressions.toLocaleString('pt-BR')} (média do conjunto: ${poolBaseline.avgImpressions.toLocaleString('pt-BR')}; percentil ${percentiles.impressions})
- Taxa de engajamento: ${post.engagement_rate.toFixed(2)}% (média: ${poolBaseline.avgEngagementRate.toFixed(2)}%; percentil ${percentiles.engagementRate})
- Novos seguidores: ${post.followers_gained.toLocaleString('pt-BR')} (média: ${poolBaseline.avgFollowersGained}; percentil ${percentiles.followersGained})
- Reações: ${post.reactions.toLocaleString('pt-BR')} | Comentários: ${post.comments.toLocaleString('pt-BR')} | Reposts: ${post.reposts.toLocaleString('pt-BR')} | Salvos: ${post.saves.toLocaleString('pt-BR')}

COMPARAÇÃO COM O GRUPO SEMELHANTE:
${cohortLine}

CARACTERÍSTICAS DO POST:
- Imagem: ${fmtBool(post.has_image)} | Link externo: ${fmtBool(post.has_link)} | Pergunta: ${fmtBool(post.has_question)}
- Bullets: ${fmtBool(post.has_bullet_points)} | Negrito Unicode: ${fmtBool(post.has_bold_unicode)} | Emoji: ${fmtBool(post.has_emoji)}
- ${post.word_count} palavras

CONJUNTO DE COMPARAÇÃO: ${poolBaseline.size} posts capturados.

${OUTPUT_FORMAT_INSTRUCTIONS}`;
}
