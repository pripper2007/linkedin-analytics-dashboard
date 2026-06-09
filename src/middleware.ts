// Shared-password auth gate for the dashboard.
//
// Runs on every page request matched below; checks the session cookie,
// redirects to /login when missing or invalid. The originally-requested
// URL is preserved as ?next=… so the user lands back where they aimed.
//
// CRITICAL: API routes are EXCLUDED from this matcher. The browser
// extension calls /api/ingest, /api/mirror-media, etc. with its own
// X-Ingest-Secret auth — middleware must not block those.

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  // If env vars aren't set, the auth system is broken — fail closed
  // (redirect to login with a config error) rather than fail open and
  // serve the dashboard publicly. The login page surfaces the error.
  if (!secret) {
    const url = new URL('/login', req.url);
    url.searchParams.set('error', 'config');
    return NextResponse.redirect(url);
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const expiresAt = await verifySession(cookie, secret);
    if (expiresAt) return NextResponse.next();
  }

  // Not authenticated — redirect to /login with the original URL preserved.
  const loginUrl = new URL('/login', req.url);
  const nextPath = req.nextUrl.pathname + req.nextUrl.search;
  if (nextPath && nextPath !== '/') {
    loginUrl.searchParams.set('next', nextPath);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Protect everything EXCEPT:
  //   - /api/*        (extension endpoints have their own auth)
  //   - /login        (the gate itself)
  //   - /_next/*      (framework assets)
  //   - /favicon.ico  (asset)
  //   - any path with a literal "." (static files like .png/.css/.woff2)
  matcher: ['/((?!api|login|_next/static|_next/image|favicon\\.ico|.*\\..*).*)'],
};
