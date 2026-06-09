// Zod schema for a parsed post-analysis result. The route streams raw
// markdown text from Claude and uses parseAnalysisMarkdown() to split
// it into the four sections; the schema then validates the result
// before persisting to post_analyses.
//
// Output sections live in src/lib/analyze-post/prompt.ts so the prompt
// and the parser stay in sync.

import { z } from 'zod';
import { ANALYSIS_SECTION_HEADERS } from './prompt';

export const analysisOutputSchema = z.object({
  whatWorked: z.string().min(1),
  whatCouldImprove: z.string().min(1),
  rewriteSuggestions: z.string().min(1),
  lessonToRemember: z.string().min(1),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

/**
 * Split Claude's streamed markdown into the four named sections.
 * Tolerates surrounding whitespace and missing leading text. Throws if
 * any section is missing — surfaces a clear error to the caller, who
 * can decide whether to retry.
 */
export function parseAnalysisMarkdown(text: string): AnalysisOutput {
  const [worked, improve, rewrite, lesson] = ANALYSIS_SECTION_HEADERS;
  // Match each "## <header>" up to the next "## " or end-of-text.
  // Anchored on word boundaries to avoid matching mid-line.
  function extractSection(header: string): string {
    const re = new RegExp(
      `##\\s+${header.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      'i',
    );
    const m = re.exec(text);
    if (!m) throw new Error(`missing section: "${header}"`);
    return m[1].trim();
  }

  return analysisOutputSchema.parse({
    whatWorked: extractSection(worked),
    whatCouldImprove: extractSection(improve),
    rewriteSuggestions: extractSection(rewrite),
    lessonToRemember: extractSection(lesson),
  });
}
