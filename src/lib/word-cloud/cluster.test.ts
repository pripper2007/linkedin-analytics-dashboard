import { describe, it, expect } from 'vitest';
import { __internals__, clusterWords } from './cluster';

describe('cacheKey', () => {
  it('produces the same key regardless of input order', () => {
    const a = [
      { stem: 'pay', count: 5, examples: ['payment'] },
      { stem: 'ai', count: 10, examples: ['ia'] },
    ];
    const b = [
      { stem: 'ai', count: 10, examples: ['ia'] },
      { stem: 'pay', count: 5, examples: ['payment'] },
    ];
    expect(__internals__.cacheKey(a)).toBe(__internals__.cacheKey(b));
  });

  it('produces different keys when counts differ', () => {
    const a = [{ stem: 'pay', count: 5, examples: ['payment'] }];
    const b = [{ stem: 'pay', count: 6, examples: ['payment'] }];
    expect(__internals__.cacheKey(a)).not.toBe(__internals__.cacheKey(b));
  });
});

describe('clusterWords', () => {
  it('returns an empty result for empty input without hitting the API', async () => {
    const r = await clusterWords([]);
    expect(r).toEqual({ clusters: [], excluded: [] });
  });

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    // Test isolation: guard against a real key leaking into the test run.
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await clusterWords([
        { stem: 'pay', count: 5, examples: ['payment'] },
      ]);
      expect(r).toBeNull();
    } finally {
      if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});
