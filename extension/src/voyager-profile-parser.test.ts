// Unit tests for the profile parsers.

import { describe, it, expect } from 'vitest';
import {
  parseConnectionsSummary,
  parseConnectionsCountFromText,
  parseFollowerCountFromHtml,
  sampleFollowerLabelContext,
  isConnectionsSummaryUrl,
} from './voyager-profile-parser';

// -------------------------------------------------------------------------
// parseFollowerCountFromHtml
// -------------------------------------------------------------------------
describe('parseFollowerCountFromHtml', () => {
  it('extracts a comma-formatted follower count from profile HTML', () => {
    const html =
      `<html><body>` +
      `<div><p componentkey="hdr">10,228 followers</p></div>` +
      `</body></html>`;
    expect(parseFollowerCountFromHtml(html)).toBe(10228);
  });

  it('extracts a plain integer follower count', () => {
    expect(parseFollowerCountFromHtml('<p>123 followers</p>')).toBe(123);
  });

  it('tolerates HTML markup between the number and the word', () => {
    // Real-world LinkedIn DOM wraps the count in nested tags.
    const html = `<p><strong>10,228</strong> followers</p>`;
    expect(parseFollowerCountFromHtml(html)).toBe(10228);
  });

  it('ignores numbers embedded inside <script> blocks', () => {
    // Embedded JSON payloads can mention "followers" in unrelated contexts
    // (other users in a recommendations array, etc.). Script contents get
    // stripped so they cannot pollute the match.
    const html =
      `<script>const x = { count: 99, label: "followers" };</script>` +
      `<p>10,228 followers</p>`;
    expect(parseFollowerCountFromHtml(html)).toBe(10228);
  });

  it('supports pt-BR: "seguidores" with period as thousands separator', () => {
    const html = `<p><strong>10.228</strong> seguidores</p>`;
    expect(parseFollowerCountFromHtml(html)).toBe(10228);
  });

  it('supports singular forms (1 follower / 1 seguidor)', () => {
    expect(parseFollowerCountFromHtml('<p>1 follower</p>')).toBe(1);
    expect(parseFollowerCountFromHtml('<p>1 seguidor</p>')).toBe(1);
  });

  it('returns the first match (profile header renders before recommendations)', () => {
    const html =
      `<p>10,228 followers</p>` +
      `<aside><p>500 followers</p><p>1,234 followers</p></aside>`;
    expect(parseFollowerCountFromHtml(html)).toBe(10228);
  });

  it('is case-insensitive on the word "followers"', () => {
    expect(parseFollowerCountFromHtml('1,500 Followers')).toBe(1500);
  });

  it('returns null when no match is present', () => {
    expect(parseFollowerCountFromHtml('<html></html>')).toBeNull();
    expect(parseFollowerCountFromHtml('followers')).toBeNull();
    expect(parseFollowerCountFromHtml('')).toBeNull();
  });
});

// -------------------------------------------------------------------------
// parseConnectionsSummary
// -------------------------------------------------------------------------
describe('parseConnectionsSummary', () => {
  it('returns the numConnections field', () => {
    const response = {
      entityUrn: 'urn:li:fs_relConnectionsSummary:urn:li:member:12345',
      numConnections: 4882,
    };
    expect(parseConnectionsSummary(response)).toBe(4882);
  });

  it('returns null when numConnections is missing', () => {
    expect(parseConnectionsSummary({})).toBeNull();
    expect(parseConnectionsSummary({ entityUrn: 'x' })).toBeNull();
    expect(parseConnectionsSummary(null)).toBeNull();
  });

  it('returns null when numConnections is not a number', () => {
    expect(parseConnectionsSummary({ numConnections: 'a-lot' })).toBeNull();
  });
});

// -------------------------------------------------------------------------
// parseConnectionsCountFromText — DOM fallback for /mynetwork list page
// -------------------------------------------------------------------------
describe('parseConnectionsCountFromText', () => {
  it('extracts N from "N connections" (en)', () => {
    expect(parseConnectionsCountFromText('347 connections')).toBe(347);
    expect(parseConnectionsCountFromText('1,234 connections')).toBe(1234);
    expect(parseConnectionsCountFromText('1 connection')).toBe(1);
  });

  it('extracts N from Portuguese label variants', () => {
    expect(parseConnectionsCountFromText('1.234 conexões')).toBe(1234);
    expect(parseConnectionsCountFromText('1 conexão')).toBe(1);
  });

  it('tolerates surrounding text and picks the first match', () => {
    const body =
      'Home My Network 1,234 connections Connect with people you know Add skills';
    expect(parseConnectionsCountFromText(body)).toBe(1234);
  });

  it('returns null when no label is present', () => {
    expect(parseConnectionsCountFromText('Search LinkedIn')).toBeNull();
    expect(parseConnectionsCountFromText('')).toBeNull();
  });

  // Regression: the LinkedIn DOM collapses whitespace between "connections"
  // and the sort-by control, producing "4,884 connectionsSort by:...".
  // The old `\b` suffix failed because `s→S` is not a word boundary.
  it('matches "N connectionsX" when directly followed by an uppercase letter', () => {
    const body =
      'NotificationsMeFor BusinessAdvertise4,884 connectionsSort by:Recently addedSearch with filters';
    expect(parseConnectionsCountFromText(body)).toBe(4884);
  });

  it('does not match "connectionsomething" (lowercase continuation)', () => {
    // If the label is immediately followed by a lowercase letter, it's a
    // different word entirely and should NOT match.
    expect(
      parseConnectionsCountFromText('1,234 connectionsomething else'),
    ).toBeNull();
  });
});

// -------------------------------------------------------------------------
// URL matcher
// -------------------------------------------------------------------------
describe('isConnectionsSummaryUrl', () => {
  it('matches the connectionsSummary endpoint', () => {
    expect(
      isConnectionsSummaryUrl(
        'https://www.linkedin.com/voyager/api/relationships/connectionsSummary',
      ),
    ).toBe(true);
  });

  it('does not match unrelated relationships endpoints', () => {
    expect(
      isConnectionsSummaryUrl(
        'https://www.linkedin.com/voyager/api/relationships/invitations',
      ),
    ).toBe(false);
  });
});

// -------------------------------------------------------------------------
// sampleFollowerLabelContext — diagnostic excerpt helper
// -------------------------------------------------------------------------
describe('sampleFollowerLabelContext', () => {
  it('returns null when neither label appears', () => {
    expect(sampleFollowerLabelContext('<p>hello</p>')).toBeNull();
  });

  it('extracts surrounding text near "followers"', () => {
    const html =
      '<div>header stuff</div>' +
      '<p>You currently have 10,228 followers on LinkedIn</p>';
    const ctx = sampleFollowerLabelContext(html, 40);
    expect(ctx).toContain('10,228 followers');
  });

  it('extracts surrounding text near "seguidores"', () => {
    const ctx = sampleFollowerLabelContext(
      '<p>10.228 seguidores no LinkedIn</p>',
      40,
    );
    expect(ctx).toContain('seguidores');
  });
});
