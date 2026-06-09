# Known shortcomings & honest caveats

This project works and is genuinely useful — it runs a real, self-hosted
LinkedIn analytics dashboard for its author every day. But it is a personal
project that grew organically, not a polished product. If you fork it, go in
with eyes open. This document is deliberately blunt.

---

## 1. The Chrome extension is the weakest link

The extension is what makes the whole thing work (it's the only way personal
LinkedIn analytics enter the system), and it's also the part most likely to
break on you. **Budget time to fix it, not just install it.**

### It depends on LinkedIn's private, undocumented internal API

The capture path works by installing a `fetch` / `XMLHttpRequest` interceptor
in the page (MAIN world) and watching for LinkedIn's internal Voyager GraphQL
calls — specifically a URL containing
`voyagerFeedDashProfileUpdates.<16-hex-queryId>`. There is **no public API**;
this is LinkedIn's own frontend traffic.

Consequences:
- **It breaks silently when LinkedIn changes anything.** When LinkedIn rotates
  the `queryId`, renames the operation, or moves data to RSC/server components,
  the interceptor matches nothing and capture quietly returns **0 posts** —
  while still reporting `success`. This already happened once: the follower
  count migrated to RSC-rendered HTML in April 2026, forcing a DOM-scrape
  fallback. Expect more of this.
- **The regex matchers in `extension/src/voyager-*.ts` are the first thing to
  check** when the DB goes stale. They encode assumptions about LinkedIn's
  current response shapes.

### The orchestration is fragile

- **Backfill aborts early under throttling.** The loop that refreshes older
  posts stops after **3 consecutive non-captures** (throttle / timeout /
  no-hydration). On a rate-limited session it bails quickly and leaves gaps.
  In practice the author has seen ~40% of historical posts with no metrics
  snapshot at any given time.
- **Background-tab throttling required a hack.** Chrome throttles JS in
  background tabs, which stalled React hydration and broke capture. The
  workaround opens a *focused popup window* to host the capture tabs. It works,
  but it's intrusive (a window pops up) and brittle.
- **MV3 service-worker lifecycle.** Orchestration runs off `chrome.alarms`; the
  worker can be evicted at any time and all transient state lives in
  `chrome.storage`. Restarts and long idle periods can interrupt runs.
- **Legacy post-ID resolution fails often.** Old `share`/`ugcPost` URLs need to
  be resolved to `urn:li:activity` IDs. Deleted, auth-walled, or otherwise
  inaccessible posts simply never resolve (hundreds of failures observed). The
  queue skips retries within 24h to avoid infinite loops.

### Failures are hard to see

Because the failure mode is "0 posts, status success," a lot of diagnostic
instrumentation had to be bolted on after the fact: a **tick log**, **page
fingerprints**, a **probe-post button**, and per-stage miss counters in the
Options page. You will rely on these to figure out *why* a run captured
nothing. They are a symptom of the underlying brittleness, not a feature to be
proud of.

### No real test coverage of live behavior

There are unit tests for the **parsers** (`voyager-*.test.ts`) against saved
fixtures, which is good. But there is **no integration test** and **no CI** that
catches a LinkedIn layout change — you find out when your dashboard data stops
updating. The fixtures also can't be committed (they contain personal content),
so a fresh clone has no parser fixtures at all.

### Distribution is manual

The extension is **not** on the Chrome Web Store. You build it
(`npm run ext:build`), load it unpacked via `chrome://extensions`, and re-load
it after every change. The dashboard URL and ingest secret are pasted into the
Options page by hand.

### If you want to make it robust

Realistic improvements a contributor could tackle, roughly in priority order:
1. **Detect-and-alert on capture==0** so silent failures become loud (e.g. a
   health check that flags "ingested but captured nothing N days running").
2. **Make the Voyager matchers resilient** — match on response *shape* rather
   than a hardcoded `queryId`, so a queryId rotation doesn't break everything.
3. **Add an integration smoke test** that runs the parsers against a small set
   of redacted fixtures in CI.
4. **Replace the popup-window hack** with `chrome.offscreen` or a cleaner
   capture strategy.

---

## 2. Some data still requires manual imports

The extension covers per-post metrics, demographics, and follower/connection
counts. But two data sources are **not** automated and must be uploaded by hand
on the `/data-health` page:

- **AggregateAnalytics `.xlsx`** (LinkedIn's "Export" on the analytics page) —
  feeds `daily_engagement` and `profile_demographics`. LinkedIn nudges you to
  re-export roughly every 45 days; until you do, those tables go stale.
- **"Get a copy of your data" `.zip`** — feeds `user_comments`,
  `user_reactions`, `user_connections` (your engagement *on other people's*
  posts). LinkedIn takes minutes-to-hours to generate the archive.

There is no scheduled reminder beyond a staleness banner; refreshing is on you.

---

## 3. Data completeness & accuracy caveats

- **LinkedIn's own retention limits apply.** Per-post impression demographics
  disappear after ~360 days; aggregate analytics after ~24 months. The
  dashboard detects and flags the demographics wall, but it can't recover data
  LinkedIn no longer serves.
- **Snapshots are point-in-time.** Metrics are captured whenever the extension
  runs, so a post's numbers in the DB reflect the last successful capture, not
  necessarily "right now."
- **Historical coverage is uneven.** Older posts that have scrolled out of
  LinkedIn's "recent" views only get refreshed if the backfill reaches them
  before aborting (see §1).

---

## 4. Architecture & auth limitations

- **Single-user, single-password.** Auth is one shared `DASHBOARD_PASSWORD` and
  a signed cookie. There are no accounts, roles, or multi-tenancy. It's built
  for one person hosting their own data.
- **Migrating from a legacy model.** The repo still carries artifacts of an
  earlier "static export + committed JSON" design (see `PROJECT.md`). Some
  scripts (`scripts/seed.ts`) expect a legacy master JSON that a fresh fork
  won't have — a clean install starts with an empty DB and fills it via the
  extension, not the seed.
- **AI features cost money and hit rate limits.** `/idea-cloud` and the per-post
  critique call the Anthropic API. They need a key with available quota; the
  author hit org-level model rate limits on Opus and fell back to Sonnet. Treat
  them as optional enrichment, not core.

---

## 5. Legal / Terms-of-Service gray area — read this

This tool automates extraction of **your own** analytics from **your own**
authenticated LinkedIn session, for **personal, non-commercial** use. It does
**not** scrape other users, does not use bots or fake accounts, and does not
touch any third-party data you don't already have access to.

That said: LinkedIn's User Agreement broadly restricts automated access to the
site, including via browser extensions that read its internal API. **This lives
in a gray area.** There is some legal precedent that scraping *public* data is
permissible (e.g. *hiQ v. LinkedIn*), but that is not a blanket authorization,
and your situation may differ.

**Use at your own risk.** Possible consequences include rate-limiting,
warnings, or account action by LinkedIn. The author accepts no liability (see
`LICENSE`). If you're not comfortable with that, don't run the extension —
the dashboard still works with the manual `.xlsx` / `.zip` imports alone.
