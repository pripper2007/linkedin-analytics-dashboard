import { describe, it, expect } from 'vitest';
import { parseAnalysisMarkdown } from './schema';

describe('parseAnalysisMarkdown', () => {
  it('splits the four expected sections', () => {
    const md = `## O que funcionou

O hook abriu com um número concreto, o que sempre prende atenção.
A estrutura em três blocos manteve o leitor.

## O que pode melhorar

A conclusão ficou muito genérica. Falta um call-to-action específico.

## Sugestões de reescrita

Trocar "muitas empresas" por uma referência concreta a um caso recente.

## Lição para guardar

Posts com número no hook + tema regulatório consistentemente acima da mediana.
`;
    const out = parseAnalysisMarkdown(md);
    expect(out.whatWorked).toContain('hook abriu com um número');
    expect(out.whatCouldImprove).toContain('genérica');
    expect(out.rewriteSuggestions).toContain('caso recente');
    expect(out.lessonToRemember).toContain('regulatório');
  });

  it('throws when a section is missing', () => {
    const md = `## O que funcionou\nbla\n## O que pode melhorar\nbla\n## Sugestões de reescrita\nbla\n`;
    expect(() => parseAnalysisMarkdown(md)).toThrow(/missing section/);
  });

  it('tolerates leading/trailing whitespace and extra blank lines', () => {
    const md = `\n\n## O que funcionou\n\nx\n\n## O que pode melhorar\n\ny\n\n## Sugestões de reescrita\n\nz\n\n## Lição para guardar\n\nw\n\n\n`;
    const out = parseAnalysisMarkdown(md);
    expect(out.whatWorked).toBe('x');
    expect(out.lessonToRemember).toBe('w');
  });
});
