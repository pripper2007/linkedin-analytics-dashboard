// Unit tests for seed transforms. No DB, no I/O — just verify the pure
// functions that convert JSON → DB rows behave correctly on edge cases.

import { describe, it, expect } from 'vitest';

import {
  parsePct,
  parsePostedAt,
  toPostRow,
  toSnapshotRow,
  toDemographicRows,
  toProfileSnapshotRow,
  toDailyEngagementRow,
} from './seed-transforms';
import type {
  Post as JsonPost,
  Profile as JsonProfile,
  DailyEntry as JsonDailyEntry,
  Demographics as JsonDemographics,
} from '../src/lib/types';

// -------------------------------------------------------------------------
// parsePct
// -------------------------------------------------------------------------
describe('parsePct', () => {
  it('parses simple integer percentages', () => {
    expect(parsePct('35%')).toBe(35);
    expect(parsePct('2%')).toBe(2);
    expect(parsePct('0%')).toBe(0);
  });

  it('parses decimal percentages', () => {
    expect(parsePct('1.5%')).toBe(1.5);
  });

  it('maps "<1%" to its midpoint (0.5)', () => {
    expect(parsePct('<1%')).toBe(0.5);
  });

  it('maps ">99%" to its midpoint (99.5)', () => {
    expect(parsePct('>99%')).toBe(99.5);
  });

  it('ignores surrounding whitespace', () => {
    expect(parsePct('  35%  ')).toBe(35);
    expect(parsePct(' <1% ')).toBe(0.5);
  });

  it('returns 0 for malformed input rather than throwing', () => {
    expect(parsePct('')).toBe(0);
    expect(parsePct('abc')).toBe(0);
  });
});

// -------------------------------------------------------------------------
// parsePostedAt
// -------------------------------------------------------------------------
describe('parsePostedAt', () => {
  it('parses a PM time in São Paulo timezone to the correct UTC', () => {
    // 6:50 PM in São Paulo (UTC-3) = 21:50 UTC
    const result = parsePostedAt('4/3/2026', '6:50 PM');
    expect(result.toISOString()).toBe('2026-04-03T21:50:00.000Z');
  });

  it('parses a morning AM time correctly', () => {
    // 9:00 AM in São Paulo = 12:00 UTC
    const result = parsePostedAt('1/15/2026', '9:00 AM');
    expect(result.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('handles 12 PM (noon) correctly', () => {
    // 12:00 PM in São Paulo = 15:00 UTC
    const result = parsePostedAt('1/1/2026', '12:00 PM');
    expect(result.toISOString()).toBe('2026-01-01T15:00:00.000Z');
  });

  it('handles 12 AM (midnight) correctly', () => {
    // 12:00 AM in São Paulo = 03:00 UTC (same day)
    const result = parsePostedAt('1/1/2026', '12:00 AM');
    expect(result.toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });

  it('pads single-digit months and days', () => {
    const result = parsePostedAt('7/8/2026', '10:00 AM');
    expect(result.toISOString()).toBe('2026-07-08T13:00:00.000Z');
  });

  it('throws on invalid date format', () => {
    expect(() => parsePostedAt('not-a-date', '10:00 AM')).toThrow(
      /Invalid post_date/,
    );
  });

  it('throws on invalid time format', () => {
    expect(() => parsePostedAt('1/1/2026', 'lunch time')).toThrow(
      /Invalid publish_time/,
    );
  });

  it('falls back to midnight when publish_time is empty', () => {
    // 00:00 in São Paulo = 03:00 UTC
    const result = parsePostedAt('1/1/2026', '');
    expect(result.toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });

  it('falls back to midnight when publish_time is whitespace only', () => {
    const result = parsePostedAt('1/1/2026', '   ');
    expect(result.toISOString()).toBe('2026-01-01T03:00:00.000Z');
  });
});

// -------------------------------------------------------------------------
// toPostRow / toSnapshotRow — sanity checks on the field mapping.
// -------------------------------------------------------------------------
const samplePost: JsonPost = {
  activity_id: '7445950871907078144',
  post_content: 'hello world',
  post_date: '4/3/2026',
  publish_time: '6:50 PM',
  post_url: 'https://linkedin.com/posts/example',
  has_link: false,
  has_image: true,
  has_bold_unicode: true,
  has_emoji: true,
  has_bullet_points: false,
  has_question: true,
  word_count: 270,
  paragraph_count: 1,
  topic: 'AI/Technology',
  style: 'Personal narrative',
  image_type: 'ai_tech_conceptual',
  feature_count: 5,
  impressions: 26090,
  members_reached: 17236,
  social_engagements: 440,
  reactions: 360,
  comments: 32,
  reposts: 2,
  saves: 32,
  sends: 14,
  profile_viewers: 180,
  followers_gained: 21,
  demographics: null,
  data_source: 'official_single_post_analytics',
  engagement_rate: 1.6875,
};

describe('toPostRow', () => {
  it('maps scalar fields and computes postedAt', () => {
    const row = toPostRow(samplePost);
    expect(row.activityId).toBe('7445950871907078144');
    expect(row.wordCount).toBe(270);
    expect(row.hasImage).toBe(true);
    expect(row.hasLink).toBe(false);
    expect(row.topic).toBe('AI/Technology');
    expect(row.postedAt.toISOString()).toBe('2026-04-03T21:50:00.000Z');
  });

  it('coerces empty strings to null for optional text fields', () => {
    const row = toPostRow({ ...samplePost, topic: '', style: '' });
    expect(row.topic).toBeNull();
    expect(row.style).toBeNull();
  });
});

describe('toSnapshotRow', () => {
  it('maps metrics and stores engagement_rate as string', () => {
    const row = toSnapshotRow(samplePost, '2026-04-12');
    expect(row.activityId).toBe('7445950871907078144');
    expect(row.snapshotDate).toBe('2026-04-12');
    expect(row.impressions).toBe(26090);
    expect(row.reactionsTotal).toBe(360);
    // numeric columns in Drizzle round-trip as strings.
    expect(row.engagementRate).toBe('1.6875');
    expect(row.dataSource).toBe('official_single_post_analytics');
  });
});

// -------------------------------------------------------------------------
// toDemographicRows
// -------------------------------------------------------------------------
describe('toDemographicRows', () => {
  const demographics: JsonDemographics = {
    job_title: [
      { value: 'CEO', pct: '10%' },
      { value: 'Founder', pct: '<1%' },
    ],
    location: [{ value: 'São Paulo', pct: '35%' }],
    seniority: [],
    company: [],
    industry: [],
    company_size: [],
  };

  it('flattens all categories into rows with 1-based rank', () => {
    const rows = toDemographicRows('abc', '2026-04-12', demographics);
    expect(rows).toHaveLength(3);
    const ceoRow = rows.find((r) => r.value === 'CEO');
    expect(ceoRow?.rank).toBe(1);
    expect(ceoRow?.pct).toBe('10.00');
    const founderRow = rows.find((r) => r.value === 'Founder');
    expect(founderRow?.rank).toBe(2);
    expect(founderRow?.pct).toBe('0.50'); // "<1%" → midpoint 0.5
  });

  it('returns [] when demographics is null', () => {
    const rows = toDemographicRows('abc', '2026-04-12', null);
    expect(rows).toEqual([]);
  });

  it('preserves activityId and snapshotDate on every row', () => {
    const rows = toDemographicRows('xyz', '2026-04-12', demographics);
    for (const row of rows) {
      expect(row.activityId).toBe('xyz');
      expect(row.snapshotDate).toBe('2026-04-12');
    }
  });
});

// -------------------------------------------------------------------------
// toProfileSnapshotRow
// -------------------------------------------------------------------------
describe('toProfileSnapshotRow', () => {
  const profile: JsonProfile = {
    name: 'Pedro Ripper',
    title: 'CEO',
    total_followers: 10174,
    follower_growth_12mo: 2900,
    total_impressions_12mo: 367901,
    total_engagements_12mo: 10200,
  };

  it('maps followers and yearly rollups', () => {
    const row = toProfileSnapshotRow(profile, '2026-04-12');
    expect(row.snapshotDate).toBe('2026-04-12');
    expect(row.totalFollowers).toBe(10174);
    expect(row.followerGrowth12mo).toBe(2900);
  });
});

// -------------------------------------------------------------------------
// toDailyEngagementRow
// -------------------------------------------------------------------------
describe('toDailyEngagementRow', () => {
  it('passes through existing daily entry fields', () => {
    const entry: JsonDailyEntry = {
      date: '2026-04-12',
      impressions: 1200,
      engagements: 45,
      day_of_week: 'Sunday',
    };
    const row = toDailyEngagementRow(entry);
    expect(row).toEqual({
      date: '2026-04-12',
      impressions: 1200,
      engagements: 45,
      dayOfWeek: 'Sunday',
    });
  });
});
