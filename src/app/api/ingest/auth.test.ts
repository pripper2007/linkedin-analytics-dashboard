// Unit tests for the ingest shared-secret authorizer.
// No network, no Next.js — just the pure function.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorized } from './auth';

const ORIGINAL = process.env.INGEST_SECRET;

describe('isAuthorized', () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = 'the-expected-secret';
  });

  afterEach(() => {
    process.env.INGEST_SECRET = ORIGINAL;
  });

  it('accepts the exact expected secret', () => {
    expect(isAuthorized('the-expected-secret')).toBe(true);
  });

  it('rejects the wrong secret', () => {
    expect(isAuthorized('some-other-secret')).toBe(false);
  });

  it('rejects a secret of a different length', () => {
    expect(isAuthorized('short')).toBe(false);
    expect(isAuthorized('the-expected-secret-with-extra')).toBe(false);
  });

  it('rejects null / undefined / empty header values', () => {
    expect(isAuthorized(null)).toBe(false);
    expect(isAuthorized(undefined)).toBe(false);
    expect(isAuthorized('')).toBe(false);
  });

  it('fails closed when the env var is missing', () => {
    delete process.env.INGEST_SECRET;
    expect(isAuthorized('the-expected-secret')).toBe(false);
  });

  it('fails closed when the env var is empty', () => {
    process.env.INGEST_SECRET = '';
    expect(isAuthorized('the-expected-secret')).toBe(false);
  });
});
