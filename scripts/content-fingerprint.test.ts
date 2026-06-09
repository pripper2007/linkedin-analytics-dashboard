import { describe, it, expect } from 'vitest';
import { contentFingerprint, MATCH_PREFIX_CHARS } from './content-fingerprint';

describe('contentFingerprint', () => {
  it('returns null for empty input', () => {
    expect(contentFingerprint('')).toBeNull();
  });

  it('returns null for content shorter than MATCH_PREFIX_CHARS after stripping', () => {
    const short = 'a'.repeat(MATCH_PREFIX_CHARS - 1);
    expect(contentFingerprint(short)).toBeNull();
  });

  it('strips whitespace and yields the first N chars when long enough', () => {
    // 60 non-whitespace chars total (50 a's plus whitespace in between) —
    // comfortably past the 40-char length floor.
    const body = 'a '.repeat(50);
    const fp = contentFingerprint(body);
    expect(fp).not.toBeNull();
    expect(fp!.length).toBe(MATCH_PREFIX_CHARS);
    expect(fp!.replace(/\s/g, '')).toBe(fp); // no whitespace survived
  });

  it('matches seed-JSON vs CSV-export formats for the same post', () => {
    // Real example: the Shares.csv export wraps multi-line posts in
    // outer quotes and doubles any internal quotes. The seed JSON has
    // the raw form. Both should produce the same fingerprint.
    const fromSeed = 'Qual o seu P-doom?\nSe você trabalha com tecnologia, ' +
      'provavelmente já pensou nisso alguma vez.';
    const fromCsv = '"Qual o seu P-doom?"\n"Se você trabalha com tecnologia, ' +
      'provavelmente já pensou nisso alguma vez."';
    expect(contentFingerprint(fromSeed)).toBe(contentFingerprint(fromCsv));
  });

  it('does not match two posts sharing only a short common opener', () => {
    const a = 'Today I want to share some thoughts on fintech strategy in Brazil.';
    const b = 'Today I want to talk about artificial intelligence safety.';
    // First ~12 chars overlap ("TodayIwantto...") but the fingerprint
    // covers 40 chars, so the two diverge well before the floor.
    expect(contentFingerprint(a)).not.toBe(contentFingerprint(b));
  });
});
