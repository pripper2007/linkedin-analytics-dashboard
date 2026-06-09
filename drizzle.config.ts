// drizzle-kit configuration. Used by `npm run db:generate`, `db:push`,
// `db:migrate`, and `db:studio`. Reads DATABASE_URL from .env.local.

import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Next.js auto-loads .env.local at runtime, but drizzle-kit is a CLI tool
// that runs outside Next, so we load it explicitly here.
config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
