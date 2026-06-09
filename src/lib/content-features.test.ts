import { describe, it, expect } from 'vitest';
import {
  detectFeatures,
  hasImageFromType,
  countContentFeatures,
} from './content-features';

describe('detectFeatures', () => {
  it('detects http(s) links', () => {
    expect(detectFeatures('Check this out https://example.com/foo').hasLink).toBe(true);
    expect(detectFeatures('plain text with no url').hasLink).toBe(false);
  });

  it('detects emoji vs bold-unicode (they do not cross)', () => {
    // Real post snippet with rocket emoji
    const withEmoji = 'TPV de R$ 10bi 🚀';
    expect(detectFeatures(withEmoji).hasEmoji).toBe(true);
    // Bold unicode characters are NOT emojis
    const boldOnly = '𝗤𝘂𝗮𝗻𝘁𝗮𝘀 tipos de Pix';
    expect(detectFeatures(boldOnly).hasEmoji).toBe(false);
  });

  it('detects bullet points only when 3+ bullet lines exist', () => {
    const three = '- one\n- two\n- three';
    expect(detectFeatures(three).hasBulletPoints).toBe(true);
    const two = '- one\n- two';
    expect(detectFeatures(two).hasBulletPoints).toBe(false);
    const numbered = '1) one\n2) two\n3) three';
    expect(detectFeatures(numbered).hasBulletPoints).toBe(true);
    const notBullets = 'A sentence - with a dash mid-line';
    expect(detectFeatures(notBullets).hasBulletPoints).toBe(false);
  });

  it('detects questions by a literal ?', () => {
    expect(detectFeatures('What is Pix?').hasQuestion).toBe(true);
    expect(detectFeatures('Plain sentence.').hasQuestion).toBe(false);
  });

  it('detects math-bold unicode used for fake bolding on LinkedIn', () => {
    const realSnippet =
      '𝗤𝘂𝗮𝗻𝘁𝗮𝘀 "𝘁𝗶𝗽𝗼𝘀" 𝗱𝗲 𝗣𝗶𝘅 𝗲𝘅𝗶𝘀𝘁𝗲𝗺 𝗵𝗼𝗷𝗲?';
    expect(detectFeatures(realSnippet).hasBoldUnicode).toBe(true);
    expect(detectFeatures('regular text only').hasBoldUnicode).toBe(false);
  });

  it('handles empty / whitespace / null-ish input', () => {
    expect(detectFeatures('')).toEqual({
      hasLink: false,
      hasEmoji: false,
      hasBulletPoints: false,
      hasQuestion: false,
      hasBoldUnicode: false,
    });
  });

  it('realistic recent post (bold unicode + question, no link/emoji/bullets)', () => {
    const post =
      '𝗤𝘂𝗮𝗻𝘁𝗮𝘀 "𝘁𝗶𝗽𝗼𝘀" 𝗱𝗲 𝗣𝗶𝘅 𝗲𝘅𝗶𝘀𝘁𝗲𝗺 𝗵𝗼𝗷𝗲 𝗻𝗼 𝗕𝗿𝗮𝘀𝗶𝗹?\n\nAté pouco tempo, o Pix era praticamente uma coisa só.';
    const f = detectFeatures(post);
    expect(f.hasBoldUnicode).toBe(true);
    expect(f.hasQuestion).toBe(true);
    expect(f.hasLink).toBe(false);
    expect(f.hasEmoji).toBe(false);
    expect(f.hasBulletPoints).toBe(false);
    expect(countContentFeatures(f)).toBe(2);
  });
});

describe('hasImageFromType', () => {
  it('returns null when unknown', () => {
    expect(hasImageFromType(null)).toBeNull();
    expect(hasImageFromType(undefined)).toBeNull();
    expect(hasImageFromType('')).toBeNull();
  });
  it('returns false for explicit "no image" tags', () => {
    expect(hasImageFromType('none')).toBe(false);
    expect(hasImageFromType('no_image')).toBe(false);
  });
  it('returns true for any other tag', () => {
    expect(hasImageFromType('infographic')).toBe(true);
    expect(hasImageFromType('article_thumbnail')).toBe(true);
    expect(hasImageFromType('team_visit_photo')).toBe(true);
  });
});
