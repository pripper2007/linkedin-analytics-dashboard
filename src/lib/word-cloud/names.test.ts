import { describe, it, expect } from 'vitest';
import { FIRST_NAMES, extractNameTokens } from './names';

describe('FIRST_NAMES stoplist', () => {
  it('contains common PT first names', () => {
    for (const n of ['pedro', 'marcio', 'ana', 'bia', 'juliana']) {
      expect(FIRST_NAMES.has(n)).toBe(true);
    }
  });

  it('contains common EN first names', () => {
    for (const n of ['john', 'michael', 'sarah', 'emily']) {
      expect(FIRST_NAMES.has(n)).toBe(true);
    }
  });

  it('does not contain common domain words', () => {
    for (const w of ['fintech', 'pagamento', 'bemobi', 'strategy']) {
      expect(FIRST_NAMES.has(w)).toBe(false);
    }
  });
});

describe('extractNameTokens', () => {
  it('flags a pair of consecutive Title-Cased words', () => {
    const found = extractNameTokens('Thanks to Fernando Fontes for the demo');
    expect(found.has('fernando')).toBe(true);
    expect(found.has('fontes')).toBe(true);
  });

  it('does not flag isolated Title-Case words', () => {
    const found = extractNameTokens('Monday morning in Brazil');
    // "Monday" and "Brazil" are both Title-Case but not adjacent to
    // another Title-Case word, so neither should be flagged.
    expect(found.has('monday')).toBe(false);
    expect(found.has('brazil')).toBe(false);
  });

  it('handles Unicode math-bold name characters', () => {
    // 𝗠𝗮𝗿𝗰𝗶𝗼 𝗞𝗿𝗼𝗲𝗵𝗻 should normalize to Marcio Kroehn and get flagged.
    const found = extractNameTokens(
      'Valeu 𝗠𝗮𝗿𝗰𝗶𝗼 𝗞𝗿𝗼𝗲𝗵𝗻 pelo papo',
    );
    expect(found.has('marcio')).toBe(true);
    expect(found.has('kroehn')).toBe(true);
  });

  it('respects the business allowlist (does not flag Open Finance)', () => {
    const found = extractNameTokens(
      'Open Finance is reshaping Brazilian payments',
    );
    expect(found.has('open')).toBe(false);
    expect(found.has('finance')).toBe(false);
  });

  it('respects the business allowlist (does not flag Central Bank)', () => {
    const found = extractNameTokens('The Central Bank announced a new rule');
    expect(found.has('central')).toBe(false);
    expect(found.has('bank')).toBe(false);
  });
});
