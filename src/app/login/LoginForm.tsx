'use client';

// Login form. Submits to /api/login; on success the server returns a
// safe redirect path (?next or "/") which we apply via window.location
// so the cookie is included on the very next page load.

import { useState } from 'react';

import { dashboardSubtitle } from '@/lib/site-config';

interface Props {
  next: string;
  initialError?: string;
}

export default function LoginForm({ next, initialError }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    initialError === 'config'
      ? 'Server is missing DASHBOARD_PASSWORD or SESSION_SECRET. Check Vercel env vars.'
      : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, next }),
      });
      if (res.ok) {
        const data = (await res.json()) as { redirect: string };
        // Use window.location instead of router.push so the request that
        // loads the destination page includes the freshly-set cookie.
        window.location.href = data.redirect ?? '/';
        return;
      }
      if (res.status === 401) {
        setError('Incorrect password.');
      } else if (res.status === 500) {
        setError('Server config error. Contact admin.');
      } else {
        setError('Something went wrong. Try again.');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
            PR
          </div>
          <h1
            className="text-xl font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            LinkedIn Analytics
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            {dashboardSubtitle}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="password"
              className="text-xs font-medium mb-1 block"
              style={{ color: 'var(--text-muted)' }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {error && (
            <div
              className="text-sm rounded p-2"
              style={{
                color: '#dc2626',
                backgroundColor: 'rgba(220, 38, 38, 0.08)',
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p
          className="text-xs mt-4 text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          Stays signed in for 90 days on this device.
        </p>
      </div>
    </div>
  );
}
