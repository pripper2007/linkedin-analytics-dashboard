# LinkedIn Analytics Dashboard

## Project Overview
Next.js 14 analytics dashboard for Pedro Ripper's LinkedIn data. Deployed to Vercel, backed by Supabase Postgres, fed by a daily browser-extension ingest (WIP).

## Architecture in transition
This project is actively migrating from a static-export + committed-JSON model to a dynamic, DB-backed dashboard. See `PROJECT.md` → "Daily Ingest Pipeline" for the phased roadmap.

State as of the most recent commit: Phase 1 complete (Supabase schema + seed). Phases 2–5 introduce the ingest API, browser extension, dashboard → DB swap, and observability. Until Phase 4, page components still read from the legacy JSON in `data/`.

## Tech Stack
- Next.js 14 (App Router) — **no longer static export** once Phase 2 lands (needed for API routes)
- TypeScript
- Tailwind CSS 3
- Recharts (charts) + TanStack Table (tables)
- Supabase Postgres (metrics, snapshots, demographics)
- Drizzle ORM + drizzle-kit (typed DB layer, migrations)
- Vercel Blob (post media mirroring — planned, Phase 3)
- Vitest (unit tests)

## Code Layout
- `data/` — legacy JSON + CSV (still powers the dashboard pre-Phase-4)
- `src/db/schema.ts` — Drizzle table definitions (source of truth for DB shape)
- `src/db/client.ts` — server-side DB client; **never** import into a `'use client'` boundary
- `drizzle/` — generated migration SQL (committed)
- `scripts/seed.ts` + `scripts/seed-transforms.ts` — legacy JSON → Supabase importer
- `scripts/seed-transforms.test.ts` — vitest unit tests
- `scripts/verify.ts` — ad-hoc DB spot-check
- `src/lib/{data,calculations,types}.ts` — legacy data loading (will evolve in Phase 4)
- `src/components/charts/` — `'use client'` Recharts wrappers
- `src/app/` — pages (server components unless interactive)

## Key Rules
1. **No scraping, no unauthorized third-party APIs.** Data enters via: (a) legacy manual JSON updates (being phased out), (b) the upcoming Vercel Function + browser-extension ingest into Supabase. LinkedIn's official API is not used — it doesn't expose personal analytics.
2. **Chart components must be `'use client'`** — Recharts needs browser APIs.
3. **Page components are server components** unless they need `useState` / interactivity.
4. **DB access is server-side only.** Never import `src/db/client.ts` into a client component.
5. **Schema changes** go through Drizzle: edit `src/db/schema.ts` → `npm run db:generate` → commit the generated SQL → `npm run db:migrate`. Never hand-edit tables in the Supabase UI.
6. **Secrets** (`DATABASE_URL`, future ingest shared secret) live in `.env.local` and Vercel env vars — never in committed code.
7. **Use CSS custom properties** (`var(--text-primary)`, `var(--bg-card)`, etc.) for theme support.
8. **Legacy JSON edits** (pre-Phase-4) — still validate: `node -e "JSON.parse(require('fs').readFileSync('data/linkedin_analytics_master.json', 'utf8'))"`.

## Common Tasks

- **Change DB schema** → edit `src/db/schema.ts`, run `npm run db:generate`, commit generated SQL, run `npm run db:migrate`.
- **Re-seed DB from legacy JSON** (idempotent) → `npm run db:seed`.
- **Inspect DB visually** → `npm run db:studio`.
- **Run tests** → `npm run test` or `npm run test:coverage`.
- **New chart** → `src/components/charts/`, use `'use client'`, import Recharts.
- **New page** → `src/app/[route]/page.tsx`. Pre-Phase-4 reads from `@/lib/data` (JSON); post-Phase-4 queries the DB directly.
- **Modify calculations** → `src/lib/calculations.ts` (will gain DB variants in Phase 4).
- **Add a new post (legacy, pre-Phase-3 extension)** → append to `posts` array in master JSON, update `_metadata`, then optionally `npm run db:seed` to push into Supabase.

## Build & Deploy
```bash
npm run dev      # local dev
npm run build    # Next.js production build
# Push to GitHub → Vercel auto-deploys.
```
