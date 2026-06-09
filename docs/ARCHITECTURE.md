# Architecture & Builder's Guide

This document describes **everything in the project** — the data model, the API,
the dashboard, the browser extension, and the AI features — written for someone
who wants to **build their own self-hosted LinkedIn analytics system** and is
using this repo as a starting point.

> [!IMPORTANT]
> This is a **working but incomplete personal project**, not a finished product.
> It runs daily for its author, but it has real rough edges — most of all the
> **Chrome extension**, which depends on LinkedIn's private internal API and
> breaks when LinkedIn changes things. Read [`SHORTCOMINGS.md`](../SHORTCOMINGS.md)
> alongside this document. Treat this as a *reference implementation and a head
> start*, not a turnkey install.

## Table of contents
1. [System overview](#1-system-overview)
2. [Data model](#2-data-model)
3. [The ingest pipeline](#3-the-ingest-pipeline)
4. [API reference](#4-api-reference)
5. [Dashboard pages](#5-dashboard-pages)
6. [The browser extension](#6-the-browser-extension)
7. [AI features](#7-ai-features)
8. [Manual data imports](#8-manual-data-imports)
9. [Auth model](#9-auth-model)
10. [Building your own from this](#10-building-your-own-from-this)
11. [Command reference](#11-command-reference)

---

## 1. System overview

Three layers feed one Postgres database:

| Layer | Tech | Role |
|---|---|---|
| **Browser extension** | Chrome MV3, TypeScript | Reads analytics from your logged-in LinkedIn session and POSTs them to the API. **The fragile layer.** |
| **Web app** | Next.js 14 (App Router) on Vercel | Ingest + import APIs, all dashboard pages, AI endpoints. |
| **Database** | Supabase Postgres + Drizzle ORM | Single source of truth. Schema in `src/db/schema.ts`, migrations in `drizzle/`. |

Data enters three ways: (a) the extension (automatic, daily), (b) a manual
`.xlsx` upload, (c) a manual `.zip` upload. Everything else reads from the DB.
There is no scraping of other users and no third-party LinkedIn API — it's your
own session's data only.

---

## 2. Data model

12 tables, defined in [`src/db/schema.ts`](../src/db/schema.ts) (the source of
truth — change it there, then `npm run db:generate`). Grouped by where the data
comes from:

### Captured by the extension
| Table | Grain | Holds |
|---|---|---|
| `posts` | one row per post | Post content, URL, posted-at, topic/style classification, content-shape flags (`has_image`, `has_link`, `word_count`, …). |
| `post_snapshots` | one row per (post, day) | The daily time-series of per-post metrics: impressions, reach, reactions (6-type breakdown), comments, reposts, saves, engagement rate. Upserted per day → idempotent. |
| `post_demographics` | one row per (post, day, category, value) | Per-post audience breakdown: location, seniority, job title, company, industry, company size. |
| `profile_snapshots` | one row per day | Follower count, connection count, and 12-month rollups. |

### Imported from the AggregateAnalytics `.xlsx`
| Table | Holds |
|---|---|
| `daily_engagement` | Daily impressions + engagements rollup (a different LinkedIn view than per-post). |
| `profile_demographics` | Profile-level audience breakdown (company, industry, …) at the export's end-date. |

### Imported from the "Get a copy of your data" `.zip`
| Table | Holds |
|---|---|
| `user_comments` | Every comment you left on others' posts (from `Comments.csv`). |
| `user_reactions` | Every reaction you gave (from `Reactions.csv`). |
| `user_connections` | Your full 1st-degree connections list (from `Connections.csv`). |

### Derived / operational
| Table | Holds |
|---|---|
| `post_media` | Images/videos per post; `source_url` (LinkedIn CDN) + `blob_url` (mirrored to Vercel Blob). |
| `post_analyses` | Cached AI critiques (one row per run) + the skill-file hash + token counts. |
| `ingest_log` | One row per extension run — powers `/api/health` and lets you spot silent failures. |

---

## 3. The ingest pipeline

How a post's metrics get from LinkedIn into the DB:

```
LinkedIn session (your browser)
  └─ extension MAIN-world interceptor traps the Voyager GraphQL response
      └─ parses it (voyager-*.ts) into a typed payload
          └─ buffers in chrome.storage, then POSTs to /api/ingest
              with header  X-Ingest-Secret: <shared secret>
                  └─ /api/ingest validates (Zod) + upserts into posts,
                     post_snapshots, post_demographics, profile_snapshots
                     and auto-mirrors media; writes a row to ingest_log
```

Two helper queues keep the extension efficient:
- **`/api/posts-needing-capture`** — tells the extension which posts still need a
  fresh metrics snapshot, so it only opens analytics pages that matter.
- **`/api/posts-needing-id-resolve`** + **`/api/resolve-activity-id`** — legacy
  `share`/`ugcPost` URLs must be resolved to a stable `urn:li:activity` ID; this
  is the queue + resolver for that (with a 24h retry skip so it can't infinite-loop
  on deleted/auth-walled posts).

Idempotency is the key design property: every upsert keys on a natural
composite (e.g. `(activity_id, snapshot_date)`), so re-running the extension or
re-importing a file never duplicates data.

---

## 4. API reference

All routes live under `src/app/api/`. Node runtime, App Router.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `ingest` | POST | ingest-secret | Main extension ingest: posts, snapshots, demographics, profile. |
| `posts-needing-capture` | GET | ingest-secret | Queue of posts lacking a fresh snapshot. |
| `posts-needing-id-resolve` | GET | ingest-secret | Queue of posts needing URN resolution. |
| `resolve-activity-id` | POST | ingest-secret | Resolve a legacy URL → `urn:li:activity` ID. |
| `import-aggregate-xlsx` | POST | session **or** secret | Upload the AggregateAnalytics `.xlsx`. |
| `import-complete-export` | POST | session **or** secret | Upload the data-export `.zip` (JSZip-parsed in memory). |
| `mirror-media` / `mirror-media-batch` | POST | session **or** secret | Mirror post media to Vercel Blob. |
| `analyze-post/[id]` | GET/POST | session **or** secret | GET returns the cached AI critique; POST streams a fresh one. |
| `health` | GET | none | Liveness + last-ingest summary. |
| `login` / `logout` | POST | — | Set/clear the signed `dashboard_session` cookie. |

"session **or** secret" = `isAuthorizedRequest()` in
[`src/app/api/ingest/auth.ts`](../src/app/api/ingest/auth.ts) accepts either the
dashboard cookie (browser) or the `X-Ingest-Secret` header (extension/scripts).

---

## 5. Dashboard pages

Server components under `src/app/` (charts are `'use client'` Recharts wrappers
in `src/components/charts/`).

| Route | What it shows |
|---|---|
| `/` (home) | KPI tiles + a stale-data banner when the `.xlsx` is >45 days old. |
| `/posts` | Sortable/filterable table of all posts with thumbnails. |
| `/posts/[id]` | Per-post deep dive: metrics, percentile rank, cohort comparison, the media, **and the streaming AI critique**. |
| `/audience` | Aggregate audience demographics. |
| `/idea-cloud` | AI topic-cluster word cloud across all posts. |
| `/earned-media` | Estimated earned-media value (a CPM applied to impressions). |
| `/checklist` | Content "playbook" — heuristic best-practice checklist per post. |
| `/optimization` | Post-vs-post performance comparison + suggestions. |
| `/network` | Connections view built from `user_connections`. |
| `/activity` | Posting cadence + ingest activity log. |
| `/data-health` | Freshness table, KPIs, and the **manual upload** widgets (xlsx, zip, mirror button). Start here to confirm data is flowing. |
| `/login` | Single-password gate. |

---

## 6. The browser extension

**This is the part most likely to break on you — budget time for it.** Full
detail in [`SHORTCOMINGS.md` §1](../SHORTCOMINGS.md#1-the-chrome-extension-is-the-weakest-link).
A short map of the code:

| File | Role |
|---|---|
| `injected-interceptor.ts` | Runs in the page **MAIN world**; wraps `fetch`/`XHR` to capture LinkedIn's internal Voyager GraphQL responses. |
| `voyager-parser.ts`, `voyager-post-summary-parser.ts`, `voyager-profile-parser.ts` | Parse those responses into typed payloads. **These encode assumptions about LinkedIn's current response shapes** — the first thing to check when capture returns 0. |
| `content-script.ts` | ISOLATED world; bridges page messages → background, handles demographic-detail fetches. |
| `background.ts` | MV3 service worker; `chrome.alarms` orchestration, buffering, the capture/backfill loop, POSTing to the API. |
| `options.ts` / `options.html` | Config UI: ingest URL + secret, plus the diagnostics (tick log, page fingerprints, miss counters). |

How LinkedIn's internal API was mapped is documented in
[`docs/voyager-recon.md`](./voyager-recon.md) — useful if you want to make the
parsers more resilient or port the approach.

> The endpoint and secret are **not** hardcoded — you set them in the Options
> page. If you deploy to a custom domain, add it to `host_permissions` in
> `extension/public/manifest.json`.

---

## 7. AI features

Two optional features call the **Anthropic API**. Both read the key from
`process.env.ANTHROPIC_API_KEY` (via `src/lib/ai/anthropic.ts`) — **there is no
key in the code**; without the env var they degrade gracefully (return `null` /
show a "not configured" notice).

- **Topic clustering** (`/idea-cloud`) — `src/lib/word-cloud/cluster.ts` clusters
  post vocabulary into themes. Uses `messages.parse()` + structured output +
  prompt caching + adaptive thinking.
- **Per-post critique** (`/posts/[id]`) — `src/app/api/analyze-post/[id]` streams
  a structured critique. The **system prompt is a writing-rubric file** in
  `skills/` (`example-linkedin-writer.md` in this repo — **replace it with your
  own voice**). Results cache in `post_analyses`, keyed on a hash of the rubric
  so "skill updated → re-analyze" is detectable.

Cost is modest (skill file is prompt-cached). Mind provider rate limits — the
author hit org-level limits on one model tier and fell back to another.

---

## 8. Manual data imports

Two sources are **not** automated; upload them on `/data-health`:

| File | Where to get it | Refresh | Fills |
|---|---|---|---|
| `AggregateAnalytics_*.xlsx` | LinkedIn analytics page → Export | ~45 days | `daily_engagement`, `profile_demographics` |
| `Complete_..._DataExport.zip` | Settings → Data Privacy → Get a copy of your data | on request | `user_comments`, `user_reactions`, `user_connections` |

Import logic: `src/lib/aggregate-xlsx-import.ts` and
`src/lib/complete-export-import.ts` (JSZip, in-memory).

---

## 9. Auth model

Single-user. One shared `DASHBOARD_PASSWORD` → a signed `dashboard_session`
cookie (`src/lib/auth.ts`, 90-day expiry). The ingest/import APIs additionally
accept the `X-Ingest-Secret` header so the extension and scripts can call them
without a browser session. **No accounts, roles, or multi-tenancy** — it's built
for one person hosting their own data.

---

## 10. Building your own from this

A realistic path to your own system:

1. **Stand up the skeleton first.** Fork, set env vars (`.env.example`), create a
   Supabase project, `npm run db:migrate`, deploy to Vercel. You now have an
   empty-but-working dashboard behind a password.
2. **Get the manual imports working before the extension.** Upload your `.xlsx`
   and `.zip` on `/data-health`. This populates several pages immediately and
   proves the DB + app path end-to-end **without** touching the fragile bit.
3. **Then tackle the extension.** Build (`npm run ext:build`), sideload, set the
   ingest URL + secret. Expect to update the Voyager parsers — LinkedIn will have
   changed since this was written. Use the diagnostics in the Options page.
4. **Make the rubric yours.** Replace `skills/example-linkedin-writer.md` with
   your own voice before relying on the AI critique.
5. **Decide what to keep.** The dashboard pages are independent — drop the ones
   you don't want. The AI features are optional (no key → they no-op).

**Where your effort will go** (in honesty): keeping the extension alive against
LinkedIn's changes is the recurring cost. If you only want a static picture,
the manual `.xlsx`/`.zip` imports alone get you a long way with zero ToS risk.

See `SHORTCOMINGS.md` → "If you want to make it robust" for the highest-value
improvements a contributor could make.

---

## 11. Command reference

```bash
npm install            # install deps
cp .env.example .env.local   # then fill in values

npm run dev            # local dev → http://localhost:3000
npm run build          # production build

npm run db:generate    # generate a migration after editing src/db/schema.ts
npm run db:migrate     # apply migrations
npm run db:studio      # browse the DB

npm run test           # vitest
npm run ext:build      # build the extension → extension/dist/
```

Deploy: push to GitHub → import in Vercel → set every var from `.env.example`
under Settings → Environment Variables. See `README.md` for the full setup walk.
