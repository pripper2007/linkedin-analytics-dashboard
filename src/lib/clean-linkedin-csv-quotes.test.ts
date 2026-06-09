import { describe, it, expect } from 'vitest';
import { cleanLinkedInCsvQuotes } from './clean-linkedin-csv-quotes';

describe('cleanLinkedInCsvQuotes', () => {
  it('returns content unchanged when no LinkedIn-CSV marker is present', () => {
    const clean = `Hi everyone\n\nThis post has "real quotes" in it.\n\nDone.`;
    expect(cleanLinkedInCsvQuotes(clean)).toBe(clean);
  });

  it('strips paragraph-wrapping quotes and blank-line markers', () => {
    const corrupted = [
      `🚀 We're excited to share that Bemobi 4Q24 results were just released"`,
      `""`,
      `"We had our strongest Q4 results ever, wrapping up 2024."`,
      `""`,
      `"Revenue grew +20% YoY and Adjusted EBITDA increased by +19% YoY."`,
    ].join('\n');
    const expected = [
      `🚀 We're excited to share that Bemobi 4Q24 results were just released`,
      ``,
      `We had our strongest Q4 results ever, wrapping up 2024.`,
      ``,
      `Revenue grew +20% YoY and Adjusted EBITDA increased by +19% YoY.`,
    ].join('\n');
    expect(cleanLinkedInCsvQuotes(corrupted)).toBe(expected);
  });

  it('preserves real content quotes when no marker is present', () => {
    const text = `Pedro said "hello" once.\n\nThen he left.`;
    expect(cleanLinkedInCsvQuotes(text)).toBe(text);
  });

  it('handles trailing-only or leading-only quotes within a triggered cleanup', () => {
    const corrupted = `first line"\n""\n"middle line"\n""\n"last line`;
    expect(cleanLinkedInCsvQuotes(corrupted)).toBe(`first line\n\nmiddle line\n\nlast line`);
  });

  it('returns empty content unchanged', () => {
    expect(cleanLinkedInCsvQuotes('')).toBe('');
  });
});
