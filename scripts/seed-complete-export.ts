// One-shot migration: load the CSVs already extracted at
// data/linkedin-export/ into the new user_comments / user_reactions /
// user_connections tables. Run once to bring DB state up to par with
// the filesystem before refactoring consumers, and then never again
// (idempotent: onConflictDoNothing for comments/reactions, upsert for
// connections — re-running is safe).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/seed-complete-export.ts

import fs from 'node:fs';
import path from 'node:path';
import {
  importComments,
  importReactions,
  importConnections,
} from '../src/lib/complete-export-import';

async function main() {
  const dir = path.join(process.cwd(), 'data', 'linkedin-export');
  if (!fs.existsSync(dir)) {
    throw new Error(`data/linkedin-export not found at ${dir}`);
  }

  const tasks: Array<{
    name: string;
    file: string;
    fn: (text: string) => Promise<number>;
  }> = [
    { name: 'Comments', file: 'Comments.csv', fn: importComments },
    { name: 'Reactions', file: 'Reactions.csv', fn: importReactions },
    { name: 'Connections', file: 'Connections.csv', fn: importConnections },
  ];

  for (const t of tasks) {
    const filePath = path.join(dir, t.file);
    if (!fs.existsSync(filePath)) {
      console.log(`✗ ${t.file} not found, skipping`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    console.log(`Importing ${t.file} (${text.length.toLocaleString()} bytes)…`);
    const inserted = await t.fn(text);
    console.log(`  ✓ ${inserted.toLocaleString()} rows attempted`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
