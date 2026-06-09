// POST /api/login — verifies the shared password and sets the session cookie.
//
// Body: { password: string, next?: string }
// 200: { ok: true, redirect: string }
// 401: { error: 'invalid' }       (wrong password)
// 500: { error: 'config' }        (server env vars missing)

import { NextRequest, NextResponse } from 'next/server';
import {
  signSession,
  passwordsMatch,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
} from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!expectedPassword || !sessionSecret) {
    return NextResponse.json({ error: 'config' }, { status: 500 });
  }

  let body: { password?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!passwordsMatch(password, expectedPassword)) {
    return NextResponse.json({ error: 'invalid' }, { status: 401 });
  }

  // Open redirect protection: only allow same-origin paths starting with
  // a single slash. Block schemes ("https://…") and protocol-relative
  // ("//evil.com") URLs that could land users on a different site.
  const rawNext = typeof body.next === 'string' ? body.next : '';
  const safeNext =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const value = await signSession(expiresAt, sessionSecret);

  const res = NextResponse.json({ ok: true, redirect: safeNext });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_LIFETIME_MS / 1000),
  });
  return res;
}
