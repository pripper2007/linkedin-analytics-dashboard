import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize';

describe('tokenize', () => {
  it('returns [] for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('lowercases and splits on whitespace', () => {
    // Use four adjacent Title-Case words: the middle pair triggers the
    // name heuristic for the middle two words, the outer two survive.
    // We want to test lowercase+split separately from name filtering, so
    // use lowercase input to avoid the heuristic entirely.
    expect(tokenize('hello world foo bar')).toEqual([
      'hello',
      'world',
      'foo',
      'bar',
    ]);
  });

  it('drops stopwords (PT + EN)', () => {
    expect(tokenize('o gato sobre the mesa and then')).toEqual([
      'gato',
      'mesa',
    ]);
  });

  it('drops tokens shorter than 3 chars', () => {
    expect(tokenize('ai is a big idea')).toEqual(['big', 'idea']);
  });

  it('preserves Portuguese accents', () => {
    expect(tokenize('Olá, estratégia pagamentos economía')).toEqual([
      'olá',
      'estratégia',
      'pagamentos',
      'economía',
    ]);
  });

  it('normalizes Unicode math-bold to plain Latin', () => {
    // 𝗢𝗽𝗲𝗻𝗖𝗹𝗮𝘄 (mathematical sans-serif bold) should collapse to openclaw.
    expect(tokenize('𝗢𝗽𝗲𝗻𝗖𝗹𝗮𝘄 launches today')).toEqual([
      'openclaw',
      'launches',
    ]);
  });

  it('strips URLs', () => {
    expect(tokenize('visit https://example.com/foo?q=1 now')).toEqual(['visit']);
    expect(tokenize('see http://site.com here friend')).toEqual(['see', 'friend']);
  });

  it('strips @mentions but keeps surrounding words', () => {
    expect(tokenize('cheers @someone, excellent work today')).toEqual([
      'cheers',
      'excellent',
      'work',
    ]);
  });

  it('keeps hashtag words without the # prefix', () => {
    expect(tokenize('#Bemobi launch #openclaw news')).toEqual([
      'bemobi',
      'launch',
      'openclaw',
      'news',
    ]);
  });

  it('removes punctuation and digits', () => {
    expect(tokenize('Revenue: $1,200 grew 25% in Q3!')).toEqual([
      'revenue',
      'grew',
    ]);
  });
});
