// Tests for parsePostSummaryHtml.
//
// Two tiers:
//   1. Synthetic HTML snippets — always run, cover the regex logic.
//   2. Real captured fixture at extension/test/fixtures/post-summary.html —
//      gitignored so CI can't run it; skipped automatically when absent.
//      Locally, these lock in the specific values we saw during 3d.A recon
//      (Saves=2, Followers gained=1, etc.) so regressions in either the
//      parser or LinkedIn's DOM are caught immediately.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parsePostSummaryHtml,
  parseDurationToSeconds,
  extractDemographics,
  isDemographicsRetentionLimited,
  parseDemographicDetailHtml,
} from './voyager-post-summary-parser';

// ---------------------------------------------------------------------------
// Synthetic cases — exercise each LinkedIn layout pattern the parser handles.
// ---------------------------------------------------------------------------
describe('parsePostSummaryHtml (synthetic)', () => {
  it('extracts top-card style "NUMBER LABEL"', () => {
    const html = `
      <html><body>
        <div><p>1,311</p><p>Impressions</p></div>
        <div><p>859</p><p>Members reached</p></div>
        <div><p>453</p><p>Video views</p></div>
        <div><p>2</p><p>Profile viewers from this post</p></div>
        <div><p>1</p><p>Followers gained from this post</p></div>
      </body></html>
    `;
    const p = parsePostSummaryHtml(html);
    expect(p.impressions).toBe(1311);
    expect(p.membersReached).toBe(859);
    expect(p.videoViews).toBe(453);
    expect(p.profileViewers).toBe(2);
    expect(p.followersGained).toBe(1);
  });

  it('extracts engagement-row style "LABEL NUMBER"', () => {
    const html = `
      <ul>
        <li>Reactions <p>44</p></li>
        <li>Comments <p>21</p></li>
        <li>Reposts <p>1</p></li>
        <li>Saves <p>2</p></li>
        <li>Sends on LinkedIn <p>0</p></li>
        <li>Link engagements <p>7</p></li>
      </ul>
    `;
    const p = parsePostSummaryHtml(html);
    expect(p.reactions).toBe(44);
    expect(p.comments).toBe(21);
    expect(p.reposts).toBe(1);
    expect(p.saves).toBe(2);
    expect(p.sends).toBe(0);
    expect(p.linkEngagements).toBe(7);
  });

  it('unescapes the RSC Flight payload (HTML inside a <script>)', () => {
    // LinkedIn wraps hydration data as an HTML-escaped string inside a
    // <script> tag. Our parser must unescape before tag-stripping.
    const escaped =
      '<script>var x = "&lt;p&gt;44&lt;/p&gt;&lt;p&gt;Reactions&lt;/p&gt;"</script>' +
      '&lt;p&gt;Saves&lt;/p&gt;&lt;p&gt;2&lt;/p&gt;';
    const p = parsePostSummaryHtml(escaped);
    // Script tag contents are stripped before parsing, so the first
    // escaped Reactions doesn't count. Only the standalone bit should.
    expect(p.saves).toBe(2);
    expect(p.reactions).toBeUndefined();
  });

  it('disambiguates "Watch time" from "Average watch time"', () => {
    // Both labels share a substring. Without careful handling, the regex
    // for "Watch time" would match the "Average watch time" occurrence
    // and capture the wrong duration.
    const html = `
      <div>Watch time <p>1h 29m</p></div>
      <div>Average watch time <p>11s</p></div>
    `;
    const p = parsePostSummaryHtml(html);
    expect(p.watchTimeSeconds).toBe(1 * 3600 + 29 * 60); // 5340
    expect(p.averageWatchTimeSeconds).toBe(11);
  });

  it('extracts the activity id from a URL anywhere in the HTML', () => {
    const html =
      '<a href="https://www.linkedin.com/feed/update/urn:li:activity:7451004062705119233">…</a>';
    expect(parsePostSummaryHtml(html).activityId).toBe('7451004062705119233');
  });

  it('omits fields that are absent (undefined, not null)', () => {
    const p = parsePostSummaryHtml('<html><body></body></html>');
    expect(p.impressions).toBeUndefined();
    expect(p.saves).toBeUndefined();
    expect(p.watchTimeSeconds).toBeUndefined();
    expect(p.activityId).toBeUndefined();
  });

  it('handles comma-formatted numbers (e.g. "1,311")', () => {
    const html = '<p>1,234,567</p><p>Impressions</p>';
    expect(parsePostSummaryHtml(html).impressions).toBe(1234567);
  });

  // Regression: LinkedIn flipped the Discovery/Profile activity layout
  // from "NUMBER LABEL" to "LABEL NUMBER" around 2026-04. Pedro's
  // post 7379847772230852608 captured with imp=0 (parser misread)
  // until detectLayout was added.
  it('extracts metrics from the 2026-04 label-first layout', () => {
    const html = `
      <html><body>
        <h2>Discovery</h2>
        <div><span>Impressions</span><span>18,165</span></div>
        <div><span>Members reached</span><span>7,820</span></div>
        <h2>Profile activity</h2>
        <div><span>Profile viewers from this post</span><span>80</span></div>
        <div><span>Followers gained from this post</span><span>12</span></div>
        <h2>Social engagement</h2>
        <div><span>Reactions</span><span>409</span></div>
        <div><span>Comments</span><span>6</span></div>
        <div><span>Reposts</span><span>5</span></div>
        <div><span>Saves</span><span>1</span></div>
        <div><span>Sends on LinkedIn</span><span>1</span></div>
      </body></html>
    `;
    const p = parsePostSummaryHtml(html);
    expect(p.impressions).toBe(18165);
    expect(p.membersReached).toBe(7820);
    expect(p.profileViewers).toBe(80);
    expect(p.followersGained).toBe(12);
    expect(p.reactions).toBe(409);
    expect(p.comments).toBe(6);
    expect(p.reposts).toBe(5);
    expect(p.saves).toBe(1);
    expect(p.sends).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parseDurationToSeconds — exercised indirectly above, direct tests here
// ---------------------------------------------------------------------------
describe('parseDurationToSeconds', () => {
  it.each([
    ['1h 29m', 5340],
    ['3m 42s', 222],
    ['11s', 11],
    ['45m', 2700],
    ['2h', 7200],
    ['1h 30m 15s', 5415],
    ['0s', 0],
  ])('parses %s → %i seconds', (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it.each(['', 'unknown', 'many minutes', '1:30:00'])(
    'returns null for unrecognized %s',
    (input) => {
      expect(parseDurationToSeconds(input)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Real-fixture tests — only run when the gitignored capture is present.
// ---------------------------------------------------------------------------
const FIXTURE = path.resolve(
  __dirname,
  '../test/fixtures/post-summary.html',
);
const hasFixture =
  fs.existsSync(FIXTURE) && fs.statSync(FIXTURE).size > 10_000;

describe.skipIf(!hasFixture)(
  'parsePostSummaryHtml (real fixture post-summary.html)',
  () => {
    const html = hasFixture ? fs.readFileSync(FIXTURE, 'utf8') : '';
    const p = hasFixture ? parsePostSummaryHtml(html) : null;

    // Values locked in from Pedro's capture of activity 7451004062705119233,
    // verified against LinkedIn's displayed UI at recon time. If these drift
    // it means either LinkedIn changed the DOM (recapture fixture) OR the
    // parser regressed (fix parser).
    it('extracts all expected metrics from the real capture', () => {
      expect(p?.activityId).toBe('7451004062705119233');
      expect(p?.impressions).toBe(1311);
      expect(p?.membersReached).toBe(859);
      expect(p?.reactions).toBe(44);
      expect(p?.comments).toBe(1);
      expect(p?.reposts).toBe(0);
      expect(p?.saves).toBe(2);
      expect(p?.sends).toBe(0);
      expect(p?.profileViewers).toBe(2);
      expect(p?.followersGained).toBe(1);
      expect(p?.videoViews).toBe(453);
      expect(p?.watchTimeSeconds).toBe(1 * 3600 + 29 * 60); // "1h 29m"
      expect(p?.averageWatchTimeSeconds).toBe(11); // "11s"
    });

    it('extracts demographic entries from the real capture', () => {
      const demos = p?.demographics ?? [];
      // Categories present in this fixture (from manual inspection):
      // Location / Seniority / Company size / Industry. The Job title
      // and Company tabs are visible as nav buttons but their data
      // panels weren't rendered when this snapshot was taken.
      const byCat = new Map<string, typeof demos>();
      for (const d of demos) {
        const arr = byCat.get(d.category) ?? [];
        arr.push(d);
        byCat.set(d.category, arr);
      }

      expect(byCat.get('location')?.[0]).toMatchObject({
        value: 'Greater Rio de Janeiro',
        pct: 32,
        rank: 1,
      });
      expect(byCat.get('seniority')?.[0]).toMatchObject({
        value: 'Senior',
        pct: 31,
        rank: 1,
      });
      expect(byCat.get('company_size')?.[0]).toMatchObject({
        value: '501-1,000 employees',
        pct: 21,
        rank: 1,
      });
      expect(byCat.get('industry')?.[0]).toMatchObject({
        value: 'IT Services and IT Consulting',
        pct: 18,
        rank: 1,
      });
    });
  },
);

// ---------------------------------------------------------------------------
// extractDemographics — synthetic cases.
// ---------------------------------------------------------------------------
describe('extractDemographics (synthetic)', () => {
  it('parses single-entry-per-category text', () => {
    const text =
      'Location Greater Rio de Janeiro 32% Seniority Senior 31% Industry IT Services and IT Consulting 18%';
    const demos = extractDemographics(text);
    expect(demos).toEqual([
      { category: 'location', value: 'Greater Rio de Janeiro', pct: 32, rank: 1 },
      { category: 'seniority', value: 'Senior', pct: 31, rank: 1 },
      { category: 'industry', value: 'IT Services and IT Consulting', pct: 18, rank: 1 },
    ]);
  });

  it('parses multi-entry-per-category and ranks them', () => {
    const text =
      'Job title Software Engineer 22% Senior Software Engineer 18% Engineering Manager 12% Location Greater São Paulo 28%';
    const demos = extractDemographics(text);
    const jobs = demos.filter((d) => d.category === 'job_title');
    expect(jobs.map((d) => [d.value, d.pct, d.rank])).toEqual([
      ['Software Engineer', 22, 1],
      ['Senior Software Engineer', 18, 2],
      ['Engineering Manager', 12, 3],
    ]);
    expect(demos.find((d) => d.category === 'location')?.value).toBe(
      'Greater São Paulo',
    );
  });

  it('handles "<1%" and converts to 0.5', () => {
    const text = 'Industry Software 18% Banking <1%';
    const demos = extractDemographics(text);
    expect(demos.map((d) => d.pct)).toEqual([18, 0.5]);
  });

  it('disambiguates "Company size" from "Company"', () => {
    const text =
      'Company size 501-1,000 employees 21% 11-50 employees 14% Company Acme Corp 8%';
    const demos = extractDemographics(text);
    expect(demos.find((d) => d.category === 'company_size')?.value).toBe(
      '501-1,000 employees',
    );
    expect(demos.find((d) => d.category === 'company')?.value).toBe('Acme Corp');
  });

  it('returns empty when no demographic block is present', () => {
    const text = 'Impressions 1311 Reactions 44';
    expect(extractDemographics(text)).toEqual([]);
  });

  it('returns empty on the 360-day retention-limit placeholder', () => {
    const text =
      'Post viewers demographics Some analytics are unavailable We aren\'t able to show impression demographics after 360 days';
    expect(isDemographicsRetentionLimited(text)).toBe(true);
    expect(extractDemographics(text)).toEqual([]);
  });

  it("does not fire retention check on real demographics text", () => {
    const text = 'Location Greater Rio de Janeiro 32% Seniority Senior 31%';
    expect(isDemographicsRetentionLimited(text)).toBe(false);
  });

  it('parses the live (2026-05+) subtitle-based layout', () => {
    // Pedro probed activity 7437478722091372547 and saw exactly this
    // layout — top-1 entry per category, with an English-prose subtitle
    // identifying which category it belongs to.
    const text =
      'Post viewers demographics Greater São Paulo Area From this location 32% ' +
      'Senior With this experience level 29% ' +
      'IT Services and IT Consulting In this industry 19% Show all';
    const demos = extractDemographics(text);
    expect(demos).toEqual([
      { category: 'location', value: 'Greater São Paulo Area', pct: 32, rank: 1 },
      { category: 'seniority', value: 'Senior', pct: 29, rank: 1 },
      { category: 'industry', value: 'IT Services and IT Consulting', pct: 19, rank: 1 },
    ]);
  });

  it('handles all six subtitles from the live layout', () => {
    const text =
      'Post viewers demographics ' +
      'Greater São Paulo Area From this location 32% ' +
      'Engineering Manager With this job title 18% ' +
      'Acme Corp From this company 9% ' +
      '501-1,000 employees From companies of this size 21% ' +
      'Senior With this experience level 29% ' +
      'IT Services and IT Consulting In this industry 19%';
    const demos = extractDemographics(text);
    const cats = new Set(demos.map((d) => d.category));
    expect(cats).toEqual(
      new Set(['location', 'job_title', 'company', 'company_size', 'seniority', 'industry']),
    );
  });

  it('falls back to legacy category-label format when subtitles missing', () => {
    const text = 'Location Greater Rio de Janeiro 32% Seniority Senior 31%';
    const demos = extractDemographics(text);
    expect(demos.length).toBeGreaterThan(0);
    expect(demos.some((d) => d.category === 'location' && d.value === 'Greater Rio de Janeiro')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDemographicDetailHtml — the Voyager-JSON-aware parser for
// /analytics/demographic-detail/.../?metricType=IMPRESSIONS pages.
// Uses HTML-escaped JSON snippets matching the shape Pedro probed.
// ---------------------------------------------------------------------------
describe('parseDemographicDetailHtml', () => {
  function chartModule(
    enumName: string,
    entries: Array<{ pct: number; label: string }>,
  ): string {
    // Mirrors the page's actual order: dataPoints array first, then
    // BarChart with the category enum as a sibling.
    const points = entries
      .map(
        (e) =>
          `{"image":null,"yPercent":${e.pct},` +
          `"yFormattedValue":{"textDirection":"USER_LOCALE","text":"${(e.pct * 100).toFixed(1)}%","attributesV2":[],"$type":"...TextViewModel"},` +
          `"icon":null,"yValue":null,` +
          `"xLabel":{"textDirection":"USER_LOCALE","text":"${e.label}","attributesV2":[],"$type":"...TextViewModel"},` +
          `"$type":"com.linkedin.voyager.dash.edgeinsightsanalytics.ChartDataPoint1D"}`,
      )
      .join(',');
    return (
      `{"dataPoints":[${points}]},` +
      `{"someTitle":{"$type":"...TextViewModel"},` +
      `"category":"${enumName}","$type":"com.linkedin.voyager.dash.edgeinsightsanalytics.custom.creatoranalytics.barchart.BarChart"}`
    );
  }

  it('parses a single category with multiple entries', () => {
    const html = chartModule('STRUCTURED_TITLE_OCCUPATION', [
      { pct: 0.22, label: 'Software Engineer' },
      { pct: 0.18, label: 'Senior Software Engineer' },
      { pct: 0.039, label: 'Engineering Manager' },
    ]);
    const demos = parseDemographicDetailHtml(html);
    expect(demos).toEqual([
      { category: 'job_title', value: 'Software Engineer', pct: 22, rank: 1 },
      { category: 'job_title', value: 'Senior Software Engineer', pct: 18, rank: 2 },
      { category: 'job_title', value: 'Engineering Manager', pct: 3.9, rank: 3 },
    ]);
  });

  it('parses all six categories with the live enum names', () => {
    const html =
      chartModule('STRUCTURED_TITLE_OCCUPATION', [{ pct: 0.22, label: 'Engineer' }]) +
      chartModule('OCCUPATION_SENIORITY', [{ pct: 0.29, label: 'Senior' }]) +
      chartModule('REGION_GEO', [{ pct: 0.319, label: 'Greater São Paulo Area' }]) +
      chartModule('ORGANIZATION', [{ pct: 0.087, label: 'Bemobi' }]) +
      chartModule('INDUSTRY', [{ pct: 0.185, label: 'IT Services and IT Consulting' }]) +
      chartModule('STAFF_COUNT_RANGE', [{ pct: 0.171, label: '10,001+ employees' }]);
    const demos = parseDemographicDetailHtml(html);
    const cats = new Set(demos.map((d) => d.category));
    expect(cats).toEqual(
      new Set(['job_title', 'seniority', 'location', 'company', 'industry', 'company_size']),
    );
    expect(demos.find((d) => d.category === 'location')).toMatchObject({
      value: 'Greater São Paulo Area',
      pct: 31.9,
    });
  });

  it('handles HTML-escaped quotes (the live response shape)', () => {
    // Real responses carry the JSON inside HTML — quotes become &quot;.
    const html = chartModule('REGION_GEO', [
      { pct: 0.32, label: 'Greater São Paulo Area' },
    ]).replace(/"/g, '&quot;');
    const demos = parseDemographicDetailHtml(html);
    expect(demos).toEqual([
      { category: 'location', value: 'Greater São Paulo Area', pct: 32, rank: 1 },
    ]);
  });

  it('skips schema-definition occurrences of "dataPoints"', () => {
    // The microschema embedded earlier in the page also contains
    // "dataPoints" — but as a type definition, no yPercent/xLabel.
    const schema =
      `"com.linkedin.470df3aa":{"fields":{` +
      `"dataPoints":{"type":{"array":"com.linkedin.foo"}}` +
      `}}`;
    const real = chartModule('REGION_GEO', [
      { pct: 0.32, label: 'Greater São Paulo Area' },
    ]);
    const demos = parseDemographicDetailHtml(schema + real);
    expect(demos).toHaveLength(1);
    expect(demos[0].value).toBe('Greater São Paulo Area');
  });

  it('returns [] when the page contains no demographic modules', () => {
    expect(parseDemographicDetailHtml('<html><body>nothing</body></html>')).toEqual([]);
  });
});
