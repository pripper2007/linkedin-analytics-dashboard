// Ad-hoc DB verification: prints row counts + a couple sample rows so we
// can sanity-check the seed without opening Supabase Studio.

import { sql as pg } from '../src/db/client';

async function main() {
  const tables = [
    'posts',
    'post_snapshots',
    'post_demographics',
    'post_media',
    'profile_snapshots',
    'daily_engagement',
    'ingest_log',
  ];

  console.log('Row counts:');
  for (const table of tables) {
    const rows = await pg.unsafe(`select count(*)::int as c from ${table}`);
    console.log(`  ${table.padEnd(22)} ${rows[0].c}`);
  }

  console.log('\nTop post by impressions:');
  const top = await pg`
    select p.activity_id, s.impressions, s.reactions_total, s.engagement_rate, p.topic
    from posts p
    join post_snapshots s on s.activity_id = p.activity_id
    order by s.impressions desc
    limit 1
  `;
  console.log(top[0]);

  console.log('\nMost recent profile snapshot:');
  const prof = await pg`
    select snapshot_date, total_followers, follower_growth_12mo
    from profile_snapshots
    order by snapshot_date desc
    limit 1
  `;
  console.log(prof[0]);

  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
