// POST /api/logout — clears the session cookie.
//
// Returns 200 unconditionally; the client redirects to /login afterwards.
// Implemented by setting the cookie with maxAge=0, which tells the browser
// to discard it immediately.

import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
