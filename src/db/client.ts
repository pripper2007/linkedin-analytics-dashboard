// Database client for the LinkedIn Analytics app.
//
// Why postgres.js + Drizzle: postgres.js is a modern, fast Postgres driver;
// Drizzle wraps it with a typed query builder. Everything in src/db/schema.ts
// becomes a typed API through this client.
//
// Used by: seed scripts, the Vercel Function ingest endpoint, and Next.js
// server components. Always run server-side — this file must never be
// imported into a 'use client' boundary.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Check .env.local or your Vercel env vars.',
  );
}

// Supabase enforces TLS on all connections. `ssl: 'require'` turns SSL on
// without strict CA verification (Supabase certs are valid, but this avoids
// platform-specific CA bundle issues on serverless).
//
// Connection pooling: we target the Transaction pooler (port 6543) rather
// than the Session pooler (5432). Session pooler enforces one client per
// session and hard-caps concurrent clients — fine for long-running servers
// but fails fast under Next.js dev + Vercel (each page render can open
// several parallel connections, easily blowing through the cap and
// triggering `MaxClientsInSessionMode: max clients reached`). Transaction
// pooler multiplexes through pgBouncer and handles many short-lived
// connections, which matches our workload.
//
// The tradeoff: Transaction pooler doesn't support server-side prepared
// statements. postgres.js's default `prepare: true` breaks under it, so
// we set `prepare: false` here. Drizzle's query planning is unaffected.
//
// If DATABASE_URL points at port 5432 we rewrite it to 6543 on the fly —
// lets us keep the .env.local + Vercel env var as-is during the migration
// and simplifies rollback if the transaction pooler ever misbehaves.
const SESSION_POOLER_PORT = ':5432';
const TRANSACTION_POOLER_PORT = ':6543';
const effectiveConnectionString = connectionString.includes(
  'pooler.supabase.com' + SESSION_POOLER_PORT,
)
  ? connectionString.replace(
      'pooler.supabase.com' + SESSION_POOLER_PORT,
      'pooler.supabase.com' + TRANSACTION_POOLER_PORT,
    )
  : connectionString;

const queryClient = postgres(effectiveConnectionString, {
  ssl: 'require',
  // Generous pool — transaction pooler handles the multiplexing; we're just
  // telling the driver how many pgbouncer-facing sockets to keep open.
  max: 10,
  // Required when going through pgbouncer / Supabase transaction pooler.
  prepare: false,
});

export const db = drizzle(queryClient, { schema });
export type DB = typeof db;

// Also export the raw client so scripts that need to close the connection
// cleanly (e.g. the seed script) can call `await sql.end()`.
export const sql = queryClient;
