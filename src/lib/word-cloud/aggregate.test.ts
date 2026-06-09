import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { aggregate, type AggregatePost } from './aggregate';

function post(id: string, daysAgo: number, body: string): AggregatePost {
  const d = new Date('2026-04-18T12:00:00Z');
  d.setDate(d.getDate() - daysAgo);
  return { activity_id: id, post_content: body, posted_at: d };
}

const NOW = new Date('2026-04-18T12:00:00Z');
function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

// All tests in this file exercise the deterministic (non-LLM) path.
// Clearing ANTHROPIC_API_KEY ensures clusterWords returns null and the
// aggregator falls back to stem-level display. The LLM path is covered
// separately by cluster.test.ts + integration testing.
beforeEach(() => {
  process.env.__ORIG_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (process.env.__ORIG_ANTHROPIC_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.__ORIG_ANTHROPIC_KEY;
  }
  delete process.env.__ORIG_ANTHROPIC_KEY;
});

describe('aggregate (stem-only fallback)', () => {
  it('counts word frequencies across posts in the window', async () => {
    const posts = [
      post('a', 1, 'fintech pagamentos fintech'),
      post('b', 2, 'fintech inovação'),
    ];
    const result = await aggregate(posts, daysAgo(7), NOW);
    const fintech = result.words.find((w) => w.text === 'fintech');
    expect(fintech?.count).toBe(3);
    expect(fintech?.postIds.sort()).toEqual(['a', 'b']);
    expect(result.clustered).toBe(false);
  });

  it('collapses PT plural/singular variants onto the same stem', async () => {
    // "pagamento" and "pagamentos" should aggregate under a single entry
    // whose count is 2.
    const posts = [
      post('a', 1, 'pagamento estratégia'),
      post('b', 2, 'pagamentos operação'),
    ];
    const result = await aggregate(posts, daysAgo(7), NOW);
    // Display surface picks the most-frequent form; tie breaks to first
    // seen, which is "pagamento" (count 1) vs "pagamentos" (count 1) —
    // either is acceptable, just assert the combined count.
    const payment = result.words.find(
      (w) => w.text === 'pagamento' || w.text === 'pagamentos',
    );
    expect(payment?.count).toBe(2);
    expect(payment?.postIds.sort()).toEqual(['a', 'b']);
  });

  it('excludes posts outside the current and prior windows', async () => {
    const posts = [
      post('recent', 2, 'included'),
      post('ancient', 365, 'excluded'),
    ];
    const result = await aggregate(posts, daysAgo(7), NOW);
    expect(result.words.map((w) => w.text)).toEqual(['included']);
    expect(result.currentPostCount).toBe(1);
  });

  it('flags trending when current >= 2× prior and clears absolute floor', async () => {
    const posts = [
      post('cur1', 1, 'openclaw openclaw openclaw strategy'),
      post('cur2', 2, 'openclaw openclaw openclaw launch'),
      post('prev', 10, 'openclaw openclaw early mention'),
    ];
    const result = await aggregate(posts, daysAgo(7), NOW);
    const openclaw = result.words.find((w) => w.text === 'openclaw');
    expect(openclaw?.trending).toBe(true);
  });

  it('does not flag trending for a brand-new word with tiny count', async () => {
    const posts = [post('a', 1, 'blockchain blockchain blockchain')];
    const result = await aggregate(posts, daysAgo(7), NOW);
    const block = result.words.find((w) => w.text === 'blockchain');
    expect(block?.trending).toBe(false);
  });

  it('flags a new word as trending only after it clears the absolute floor', async () => {
    const posts = [
      post('a', 1, 'crypto crypto crypto'),
      post('b', 3, 'crypto crypto'),
    ];
    const result = await aggregate(posts, daysAgo(7), NOW);
    const c = result.words.find((w) => w.text === 'crypto');
    expect(c?.trending).toBe(true);
  });

  it('does not flag trending when current is only ~equal to prior', async () => {
    const posts = [
      post('cur', 1, 'payments payments payments payments payments'),
      post('prev', 10, 'payments payments payments payments payments'),
    ];
    const result = await aggregate(posts, daysAgo(7), NOW);
    // Stems as "payment" after -s strip.
    const payments = result.words.find(
      (w) => w.text === 'payments' || w.text === 'payment',
    );
    expect(payments?.trending).toBe(false);
  });

  it('counts repeat words toward count but dedups postIds per post', async () => {
    const posts = [post('a', 1, 'strategy strategy strategy strategy')];
    const result = await aggregate(posts, daysAgo(7), NOW);
    const s = result.words.find((w) => w.text === 'strategy');
    expect(s?.count).toBe(4);
    expect(s?.postIds).toEqual(['a']);
  });
});
