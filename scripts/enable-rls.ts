// Enables Row-Level Security on every table in the public schema.
//
// WHY: Supabase's PostgREST auto-exposes every table with RLS disabled
// as readable/writable by the `anon` role. Anyone who obtains the
// project's anon key (shown in every client-side bundle that uses
// supabase-js, trivially findable) can then do `GET /rest/v1/posts`
// and read Pedro's full analytics. Enabling RLS without defining
// policies means the anon role is blocked from everything — the
// postgres superuser that our app connects as via DATABASE_URL
// bypasses RLS automatically, so our queries are unaffected.
//
// Idempotent — running this twice is a no-op. Safe to re-run if
// Supabase surfaces the warning again after a schema change that adds
// a new table.
//
// Usage: npx tsx --env-file=.env.local scripts/enable-rls.ts

import { sql } from '../src/db/client';

const TABLES = [
  'posts',
  'post_snapshots',
  'post_demographics',
  'post_media',
  'profile_snapshots',
  'profile_demographics',
  'daily_engagement',
  'ingest_log',
] as const;

async function main() {
  console.log(`Enabling RLS on ${TABLES.length} tables…\n`);

  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.unsafe(`"${table}"`)} ENABLE ROW LEVEL SECURITY`;
    console.log(`  ✓ ${table}`);
  }

  console.log('\nVerifying…');
  const rows = (await sql`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  `) as unknown as Array<{ table_name: string; rls_enabled: boolean }>;

  let allGood = true;
  for (const r of rows) {
    const mark = r.rls_enabled ? '✓' : '✗';
    console.log(`  ${mark} ${r.table_name}: rls_enabled=${r.rls_enabled}`);
    if (!r.rls_enabled) allGood = false;
  }

  if (allGood) {
    console.log(
      '\nDone. Supabase will stop flagging these as publicly accessible.',
    );
    console.log(
      'No RLS policies are defined, so the anon role cannot read or write —',
    );
    console.log(
      'our server-side app connects as postgres and bypasses RLS entirely.',
    );
  } else {
    console.log('\nSome tables still show rls_enabled=false. Check permissions.');
    process.exit(1);
  }
}

main()
  .then(() => sql.end({ timeout: 5 }).then(() => process.exit(0)))
  .catch((err) => {
    console.error(err);
    void sql.end({ timeout: 5 }).finally(() => process.exit(1));
  });
