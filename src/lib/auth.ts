// Session-cookie HMAC sign/verify for the dashboard's shared-password
// auth gate. Uses Web Crypto API so it runs identically on Node and
// Edge (middleware runs on Edge runtime in some hosting configurations).
//
// Cookie shape:  "<expiresAtMs>.<hex-hmac-sha256>"
// Verification:  recompute HMAC server-side; constant-time compare; check expiry.
//
// The secret never leaves the server, and any client tampering with
// expiresAt invalidates the signature.

const ENCODER = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, ENCODER.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Constant-time string equality. Avoids timing side channels on the HMAC compare. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function signSession(
  expiresAtMs: number,
  secret: string,
): Promise<string> {
  const message = String(expiresAtMs);
  const sig = await hmacHex(message, secret);
  return `${message}.${sig}`;
}

/**
 * Returns the session expiry timestamp if the cookie value is a valid,
 * non-expired, properly-signed token. Returns null otherwise — the
 * caller treats null as "not authenticated."
 */
export async function verifySession(
  value: string,
  secret: string,
): Promise<number | null> {
  const idx = value.indexOf('.');
  if (idx <= 0) return null;
  const expiresStr = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!expiresStr || !sig) return null;

  const expectedSig = await hmacHex(expiresStr, secret);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return expiresAt;
}

/** Constant-time password comparison. */
export function passwordsMatch(input: string, expected: string): boolean {
  const a = ENCODER.encode(input);
  const b = ENCODER.encode(expected);
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

/** Cookie name used across login/logout/middleware. */
export const SESSION_COOKIE = 'dashboard_session';

/** 90 days in milliseconds — matches the user-chosen lifetime. */
export const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
