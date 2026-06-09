// Small statistics helpers. Kept separate from calculations.ts so we
// can reuse in both the Executive Summary (inline correlation callout)
// and a future dedicated Growth Model page.

/**
 * Pearson correlation coefficient between two equal-length numeric
 * arrays. Returns null when the sample is too small (< 3) or either
 * series has zero variance (all equal values, so correlation is
 * undefined).
 */
export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}
