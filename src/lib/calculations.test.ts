// Tests for pure helpers in calculations.ts. Narrowly targets the
// Unicode-safe truncator — adding here (rather than expanding an
// existing suite) because that was the specific bug that produced
// the `�` replacement chars on the Posts Analytics page.

import { describe, it, expect } from 'vitest';
import { truncateChars } from './calculations';

describe('truncateChars', () => {
  it('returns the string unchanged when it is shorter than the limit', () => {
    expect(truncateChars('short', 10)).toBe('short');
  });

  it('truncates plain ASCII cleanly with an ellipsis', () => {
    expect(truncateChars('Hello World', 5)).toBe('Hello...');
  });

  it('preserves emoji (which are 2 UTF-16 code units each)', () => {
    // 🇧🇷 is two regional indicators = 4 UTF-16 code units.
    // substring(0, 3) would cut mid-surrogate → renders as "🇧?" or "�".
    // truncateChars must preserve the full flag.
    const input = 'Brasil 🇧🇷 é grande';
    const out = truncateChars(input, 8);
    // 8 code-points: "B" "r" "a" "s" "i" "l" " " "🇧" — flag half captured;
    // the important property is that we never emit a lone surrogate.
    expect(out).not.toContain('\uFFFD');
    // First full char boundary after the limit, no broken surrogate.
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      const isHighSurrogate = c >= 0xd800 && c <= 0xdbff;
      const isLowSurrogate = c >= 0xdc00 && c <= 0xdfff;
      if (isHighSurrogate) {
        // The next code unit MUST be a low surrogate.
        const next = out.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        i++; // skip the low surrogate
      } else {
        expect(isLowSurrogate).toBe(false);
      }
    }
  });

  it('preserves mathematical bold letters (often used in LinkedIn headings)', () => {
    // 𝗢𝗽𝗲𝗻𝗖𝗹𝗮𝘄 uses mathematical bold latin chars (U+1D400+), each 2 code units.
    // substring(0, 5) would land mid-surrogate — reality Pedro observed.
    const input = '𝗢𝗽𝗲𝗻𝗖𝗹𝗮𝘄, 𝗣𝗥𝗜𝗣 e o futuro';
    const out = truncateChars(input, 5);
    expect(out).not.toContain('\uFFFD');
    // Output should contain 5 code points from the bold set, then '...'.
    const arr = Array.from(out.replace(/\.\.\.$/, ''));
    expect(arr.length).toBe(5);
  });

  it('preserves accented Portuguese characters', () => {
    // Single-code-unit chars like "á", "ção" aren't affected by the bug,
    // but the test guards against regressions that might over-correct.
    expect(truncateChars('não é uma acção perigosa', 10)).toBe('não é uma ...');
  });

  it('accepts a custom ellipsis', () => {
    expect(truncateChars('abcdefghij', 5, '…')).toBe('abcde…');
  });

  it('treats empty input safely', () => {
    expect(truncateChars('', 10)).toBe('');
  });
});
