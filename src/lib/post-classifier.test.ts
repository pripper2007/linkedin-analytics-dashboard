// Tests for the keyword classifier. Real samples from Pedro's DB
// where possible so the rules match the vocabulary he actually uses.

import { describe, it, expect } from 'vitest';
import { classifyPost, classifyStyle, classifyTopic } from './post-classifier';

describe('classifyTopic', () => {
  it('matches Payments/Fintech on Pix / pagamentos / fintech terms', () => {
    const samples = [
      'Pagamos tudo em segundos. Menos o que é essencial.',
      'O Pix acaba de ganhar um novo mecanismo de segurança',
      'A virada da Bemobi para pagamentos não é uma aventura fintech',
      'CBDC e o real digital (drex) vão mudar o cartão de crédito no Brasil',
    ];
    for (const s of samples) {
      expect(classifyTopic(s)).toBe('Payments/Fintech');
    }
  });

  it('matches AI/Technology on IA / LLM / agente terms', () => {
    const samples = [
      'OpenClaw, PRIP e o futuro dos agentes pessoais',
      'Um fim de semana. Um time de agentes de IA. Um projeto que',
      '1º Meetup CURSOR AI no Rio de Janeiro',
      'Qual o seu P-doom? Se você trabalha com tecnologia',
      'Vibe coding, LLMs and the new generation of developer tools',
    ];
    for (const s of samples) {
      expect(classifyTopic(s)).toBe('AI/Technology');
    }
  });

  it('returns null when neither topic keyword set matches', () => {
    expect(
      classifyTopic('Our regular all hands meetings are one of the most important things we do'),
    ).toBeNull();
    expect(
      classifyTopic('Our offsite was amazing — 3 days in the mountains discussing strategy'),
    ).toBeNull();
  });

  it('resolves first-match-wins when both topic signals appear', () => {
    // A post that mentions both Pix (payments) and IA (AI) goes to
    // Payments/Fintech since that rule is checked first.
    expect(
      classifyTopic('Como a IA vai transformar o Pix no Brasil'),
    ).toBe('Payments/Fintech');
  });
});

describe('classifyStyle', () => {
  it('classifies bullet-heavy content as Structured/Lists', () => {
    const input =
      'Here are my 3 takeaways from the conference:\n\n- Takeaway one with some detail\n- Takeaway two\n- Takeaway three\n\nMore below.';
    expect(classifyStyle(input)).toBe('Structured/Lists');
  });

  it('classifies numbered lists as Structured/Lists', () => {
    const input = '1) First thing\n2) Second thing\n3) Third thing\n';
    expect(classifyStyle(input)).toBe('Structured/Lists');
  });

  it('classifies launch language as Announcement', () => {
    const launches = [
      'Anunciando o Bemobi Pay — nossa nova plataforma',
      "We're launching a new product today",
      'Lançamento: a nova geração de agentes',
    ];
    for (const s of launches) {
      expect(classifyStyle(s)).toBe('Announcement');
    }
  });

  it('classifies first-person openings as Personal narrative', () => {
    const narratives = [
      'Hoje eu passei o dia com o time de engenharia',
      'Today I want to share a story from last week',
      'Last week I shipped my first production agent',
      'Esta semana foi intensa. Eu tive a chance de conhecer',
    ];
    for (const s of narratives) {
      expect(classifyStyle(s)).toBe('Personal narrative');
    }
  });

  it('falls back to Informational for generic content', () => {
    expect(
      classifyStyle('B2B2B: a nova fronteira de pagamentos da Bemobi. Como funciona.'),
    ).toBe('Informational');
  });

  it('returns null for empty / whitespace-only content', () => {
    expect(classifyStyle('')).toBeNull();
    expect(classifyStyle('   \n\t ')).toBeNull();
  });
});

describe('classifyPost (combined)', () => {
  it('produces coherent topic + style for a realistic post', () => {
    const post =
      "Today I want to share how we're using LLMs + Pix to speed up refunds at Bemobi. " +
      'Three things we learned:\n\n' +
      '- Model choice matters less than prompt engineering\n' +
      '- Latency budget is tighter than you think\n' +
      '- Audit every decision the model makes\n';
    const c = classifyPost(post);
    // Payments/Fintech wins because the rule order puts it first, and
    // the post mentions "Pix" + "refunds" — even though LLMs is also
    // in there.
    expect(c.topic).toBe('Payments/Fintech');
    // 3 bullet lines → Structured/Lists
    expect(c.style).toBe('Structured/Lists');
  });

  it('returns { null, null } for empty input', () => {
    expect(classifyPost('')).toEqual({ topic: null, style: null });
  });
});
