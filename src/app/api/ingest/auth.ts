// Shared-secret auth for /api/ingest.
//
// The browser extension sends its INGEST_SECRET in the X-Ingest-Secret
// header. We compare against the server-side env var using a constant-time
// comparison so the endpoint doesn't leak secret length or a prefix match
// through timing.

import { timingSafeEqual } from 'node:crypto';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';

export const INGEST_SECRET_HEADER = 'x-ingest-secret';

/**
 * Returns true if the provided header value matches INGEST_SECRET.
 * - Missing header → false.
 * - Missing/empty env var → false (fail-closed so we never accidentally
 *   accept unauthenticated traffic when misconfigured).
 * - Different lengths → false (but still does a constant-time compare on
 *   a dummy buffer to equalize timing).
 */
export function isAuthorized(headerValue: string | null | undefined): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected || expected.length === 0) return false;
  if (!headerValue) {
    // Still do a constant-time compare against the expected secret so a
    // missing-header probe and a wrong-secret probe look identical.
    const expectedBuf = Buffer.from(expected);
    timingSafeEqual(expectedBuf, Buffer.alloc(expectedBuf.length));
    return false;
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) {
    // Compare against a dummy of matching length to keep timing uniform.
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Authorize a Request by EITHER:
 *   - An X-Ingest-Secret header that matches INGEST_SECRET (for the
 *     Chrome extension and CLI scripts), OR
 *   - A valid signed `dashboard_session` cookie (for buttons clicked
 *     from /data-health by an already-logged-in user).
 *
 * The dashboard's auth gate (middleware.ts) sets the cookie on
 * password-login. Once present, /api/* routes that call this helper
 * trust it as proof the user is authenticated — no extra secret needed.
 *
 * Routes used ONLY by the extension should keep calling isAuthorized()
 * directly. Use this helper only for endpoints meant to be triggered
 * from the dashboard UI.
 */
export async function isAuthorizedRequest(
  request: Request,
): Promise<boolean> {
  // Extension / CLI path.
  const secretHeader = request.headers.get(INGEST_SECRET_HEADER);
  if (secretHeader && isAuthorized(secretHeader)) return true;

  // Dashboard-session path. Parse the cookie header manually (no
  // `next/headers` here so the helper stays runtime-agnostic).
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return false;
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return false;
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((p) => {
      const i = p.indexOf('=');
      if (i < 0) return [p.trim(), ''];
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const sessionValue = cookies[SESSION_COOKIE];
  if (!sessionValue) return false;
  const expiresAt = await verifySession(sessionValue, sessionSecret);
  return expiresAt !== null;
}
