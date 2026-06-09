# LinkedIn Analytics Command Center

> Personal LinkedIn analytics dashboard for Pedro Ripper — built to replace Shield, Taplio, and other third-party tools with a self-hosted, privacy-first solution.

## Why This Exists

Third-party LinkedIn analytics tools (Shield at $8-25/mo, Taplio at $39-149/mo, Kleo at $99/mo) charge recurring fees for what is fundamentally *your own data*. They also require API access to your LinkedIn account, have clunky interfaces, and offer limited content optimization intelligence.

This project is a self-hosted Next.js dashboard that:
- Runs on Vercel (free tier) with zero recurring costs
- Keeps all data in your private GitHub repo — no third-party API access
- Provides deeper analytics than Shield (per-post demographic drill-downs, engagement funnels, content optimization engine)
- Features that no paid tool offers: feature stacking analysis, earned media value, content scoring checklist, and audience intelligence per post

## Core Objective

**Comprehensive per-post analytics** is the primary value this dashboard provides. The driving question Pedro wants to answer:

> "What kind of content drives the best engagement and results for me — so I can keep doing more of what works and less of what doesn't?"

Concretely, that means: for *every post Pedro has ever made* (to the extent LinkedIn still has the data), the DB should hold a complete `post_snapshots` row with all of LinkedIn's per-post metrics:

- Reach: `impressions`, `members_reached`
- Reactions: `reactions_total` + the 6-type breakdown (`like`, `celebrate`, `support`, `love`, `insightful`, `funny`)
- Social: `comments`, `reposts`, `saves`, `sends`
- Profile outcomes: `followers_gained`, `profile_viewers`, `link_clicks`
- Derived: `engagement_rate`
- Per-post demographics: `company`, `industry`, `seniority`, `location`, `job_title`, `company_size`

And a complete `posts` row with content-side attributes (topic, style, has_image, has_question, word_count, etc.) joined so that every analytical page (`/optimization`, `/audience`, `/growth`, `/compare`, `/posts/[id]`) can correlate content shape with engagement.

**Any roadmap item that doesn't serve this objective is lower priority.** Follower-count tracking, daily engagement rollups, and site observability are supporting infrastructure — necessary but not the headline. Phase 3d is explicitly dedicated to closing the gap between this objective and what the pipeline currently captures.

## Current State — May 2026

What's live in production:
- **Daily ingest pipeline** auto-running via `chrome.alarms`. ~50 posts have complete per-post analytics (impressions + members_reached + reactions + comments + reposts + saves + sends + profile_viewers + followers_gained + per-post demographics + media URLs). Forward captures keep feeding daily; new posts Pedro publishes appear in the dashboard within ~24h.
- **Executive Summary dashboard** reorganized around the causal cascade `posts × impr/post × ER → engagements → followers`. Range filter (7d/30d/3m/6m/12m/custom). Three range-aware charts (Followers, Impressions, Engagement) with toggle Per-period/Cumulative + per-post secondary axis. KPI ordering follows the cascade. "Best Month" badge surfaces the month with highest absolute follower gain (ties broken by ER).
- **Post deep-dive (`/posts/[id]`)**: full text rendered with formatting preserved (bold-unicode, line breaks, emojis), media served from Vercel Blob (`linkedin-media` store, GRU1 region) when mirrored — falls back to LinkedIn CDN — and interpretive cards explaining performance vs cohort (percentile rank, cohort comparison matched by topic + features, feature-signal callouts).
- **`/compare`** uses tornado/diverging-bar layout with content-score scorecards (each post gets a numeric score from feature flags), Best 5 / Worst 3 shortlists at the top with quick-pick A/B buttons that wire directly into the comparison.
- **`/earned-media`** is its own page with the CPM/CPC framing.
- **Security**: Supabase RLS enabled on all tables, `BLOB_READ_WRITE_TOKEN` provisioned, GitHub Actions deploy pipeline green.
- **Correlation analysis (preliminary)**: in the captured pool, **total engagements** is the strongest predictor of follower growth (r ≈ 0.82 at n=38; impressions r ≈ 0.64; engagement rate alone r ≈ 0.06 — near zero). Causal model is reflected in the dashboard's KPI ordering and growth-math cascade callout. Re-run with the larger pool is queued.

What's pending / in-flight:
- ~16 posts remaining in the historical backfill queue, paused while LinkedIn cools down from a recent throttle event. Will resume when the cool-down clears (typically days).
- Pedro is queueing UI / functionality fixes on top of what's shipped — those land before any new frontier work.
- The post-deep-dive's heuristic interpretive layer covers most of the analytical value at zero cost; the Phase-9 LLM-driven critique is parked until a clear gap appears that heuristics can't answer.

What's next, in order:
1. **UI / functionality fixes** on the existing dashboards (Pedro's queue).
2. **Data backlog**: restart the ~16-post backfill once LinkedIn cool-down clears; recompute correlations with the larger pool to finalize the "best posts vs best-practice" study.
3. **Phase 6 — Networking Intelligence** (hybrid: nominal connections from `Connections.csv` import + aggregate followers from existing per-post demographics). See "Secondary Initiative" below.
4. Phases 7 (engagement attribution) and 9.B (LLM critique) become viable after Phase 6 lands.

## Tech Stack

- **Framework**: Next.js 14 (App Router) — moving off static export in the ongoing Daily Ingest Pipeline migration (see below)
- **Styling**: Tailwind CSS 3
- **Charts**: Recharts
- **Tables**: TanStack Table (React Table v8)
- **Deployment**: Vercel (auto-deploy from GitHub `main` branch)
- **Database**: Supabase Postgres (via Drizzle ORM + drizzle-kit)
- **Object storage**: Vercel Blob (live — `linkedin-media` store, GRU1 region; mirrors post media so assets survive LinkedIn CDN URL rotation)
- **Testing**: Vitest + @vitest/coverage-v8
- **Data (in transition)**: legacy JSON + CSV in `data/` still power the dashboard; Supabase now holds the same data plus time-series snapshots; future daily ingest will write Supabase-only

## Project Structure

```
linkedin-analytics/
├── PROJECT.md                     # This file
├── CLAUDE.md                      # Claude Code instructions for this project
├── package.json
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── vercel.json
├── .gitignore
│
├── data/                          # All LinkedIn data (source of truth)
│   ├── linkedin_analytics_master.json   # Post analytics + daily engagement
│   ├── linkedin-export/                 # Raw LinkedIn data export
│   │   ├── Connections.csv
│   │   ├── Profile.csv
│   │   ├── Profile Summary.csv
│   │   ├── Positions.csv
│   │   ├── Skills.csv
│   │   ├── Education.csv
│   │   ├── Learning.csv
│   │   ├── messages.csv
│   │   ├── Invitations.csv
│   │   ├── Endorsement_Received_Info.csv
│   │   ├── Endorsement_Given_Info.csv
│   │   ├── Rich_Media.csv
│   │   ├── Company Follows.csv
│   │   ├── Ad_Targeting.csv
│   │   └── Articles/
│   │       └── Articles/*.html
│   ├── single-post-analytics/           # Individual post XLSX exports from LinkedIn
│   │   └── SinglePostAnalytics_*.xlsx
│   └── aggregate-analytics/             # Aggregate period XLSX exports from LinkedIn
│       └── AggregateAnalytics_*.xlsx
│
├── scripts/                       # Data processing & sync utilities
│   ├── sync-new-post.ts           # Add a new post to the master JSON
│   ├── import-xlsx.ts             # Parse SinglePostAnalytics XLSX into JSON
│   ├── import-aggregate.ts        # Parse AggregateAnalytics XLSX into JSON
│   ├── import-linkedin-export.ts  # Process LinkedIn data export CSVs
│   └── validate-data.ts           # Validate master JSON schema integrity
│
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout (dark/light mode, nav)
│   │   ├── page.tsx               # Executive Summary dashboard (home)
│   │   ├── posts/
│   │   │   ├── page.tsx           # Post Performance Explorer
│   │   │   └── [id]/
│   │   │       └── page.tsx       # Individual post deep-dive
│   │   ├── optimization/
│   │   │   └── page.tsx           # Content Optimization Engine
│   │   ├── audience/
│   │   │   └── page.tsx           # Audience Intelligence
│   │   ├── growth/
│   │   │   └── page.tsx           # Growth Tracker + timeline
│   │   ├── network/
│   │   │   └── page.tsx           # Network & Connections
│   │   ├── compare/
│   │   │   └── page.tsx           # Post Comparison Mode
│   │   └── checklist/
│   │       └── page.tsx           # Pre-publish Content Scorecard
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── ThemeToggle.tsx
│   │   ├── charts/
│   │   │   ├── ImpressionsTimeline.tsx
│   │   │   ├── EngagementFunnel.tsx
│   │   │   ├── DemographicBreakdown.tsx
│   │   │   ├── TopicPerformance.tsx
│   │   │   ├── FeatureStackingChart.tsx
│   │   │   ├── PostingHeatmap.tsx
│   │   │   ├── WordCountImpact.tsx
│   │   │   ├── EarnedMediaValue.tsx
│   │   │   └── FollowerGrowth.tsx
│   │   ├── cards/
│   │   │   ├── MetricCard.tsx
│   │   │   ├── PostCard.tsx
│   │   │   └── InsightCard.tsx
│   │   ├── tables/
│   │   │   ├── PostsTable.tsx
│   │   │   └── ConnectionsTable.tsx
│   │   └── filters/
│   │       ├── DateRangeFilter.tsx
│   │       ├── TopicFilter.tsx
│   │       └── MetricSorter.tsx
│   │
│   ├── lib/
│   │   ├── data.ts                # Load and parse all data files at build time
│   │   ├── calculations.ts        # Engagement rates, EMV, averages, rankings
│   │   ├── types.ts               # TypeScript interfaces for all data shapes
│   │   └── constants.ts           # LinkedIn CPM/CPC benchmarks, color palettes
│   │
│   └── styles/
│       └── globals.css            # Tailwind base + custom theme variables
│
└── public/
    └── favicon.ico
```

> **The tree above is the pre-Phase-1 snapshot and is not exhaustive.** Phase 1 added `src/db/` (Drizzle schema + client), `drizzle/` (generated migration SQL — committed), `scripts/{seed,seed-transforms,verify}.ts` plus `scripts/seed-transforms.test.ts`, `drizzle.config.ts`, and `vitest.config.ts`. See `CLAUDE.md` → "Code Layout" for the current authoritative list.

## Data Architecture

### Primary Data Source: `linkedin_analytics_master.json`

This is the single source of truth for all post analytics. Structure:

```typescript
interface AnalyticsMaster {
  _metadata: {
    version: string;              // "1.0"
    created: string;              // "2026-04-07"
    last_updated: string;         // "2026-04-12"
    data_period: string;          // "2025-04-13 to 2026-04-12"
    total_posts: number;          // 31
    posts_with_official_data: number; // 20
    how_to_update: string;
  };

  profile: {
    name: string;                 // "Pedro Ripper"
    title: string;                // "CEO @ Bemobi | Board Member"
    total_followers: number;      // 10174
    follower_growth_12mo: number; // 2900
    total_impressions_12mo: number; // 367901
    total_engagements_12mo: number; // 10200
  };

  posts: Post[];                  // 31 posts (see Post interface below)

  daily_engagement: DailyEntry[]; // ~365 entries (see below)
}

interface Post {
  activity_id: string;            // LinkedIn activity ID (e.g., "7445950871907078144")
  post_content: string;           // Full post text (truncated in some cases)
  post_date: string;              // "4/3/2026" or "" if unknown
  publish_time: string;           // "6:50 PM" or "" if unknown
  post_url: string;               // Full LinkedIn post URL or ""

  // Content features (boolean flags)
  has_link: boolean;
  has_image: boolean;
  has_bold_unicode: boolean;
  has_emoji: boolean;
  has_bullet_points: boolean;
  has_question: boolean;

  // Content metadata
  word_count: number;
  paragraph_count: number;
  topic: string;                  // "AI/Technology" | "Payments/Fintech" | "Company" | "Market/Economy" | "Career/Leadership"
  style: string;                  // "Personal narrative" | "Structured/Lists" | "Informational" | "Thought Leadership"
  image_type: string;             // "team_visit_photo" | "ai_tech_conceptual" | "screenshot" | "selfie_event" | "press_media"
  feature_count: number;          // 0-5+ (count of true boolean flags above)

  // Engagement metrics
  impressions: number;
  members_reached: number;        // 0 for scraped data
  social_engagements: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number;                  // 0 for scraped data
  sends: number;                  // 0 for scraped data
  profile_viewers: number;
  followers_gained: number;
  engagement_rate: number;        // Pre-calculated percentage

  // Audience demographics (null for scraped posts)
  demographics: {
    job_title: DemographicEntry[];
    location: DemographicEntry[];
    seniority: DemographicEntry[];
    company: DemographicEntry[];
    industry: DemographicEntry[];
    company_size: DemographicEntry[];
  } | null;

  data_source: "official_single_post_analytics" | "scraped";
}

interface DemographicEntry {
  value: string;
  pct: string;                    // "4%" or "< 1%" or "<1%"
}

interface DailyEntry {
  date: string;                   // "2025-04-08" (ISO format)
  impressions: number;
  engagements: number;
  day_of_week: string;            // "Tuesday"
}
```

### LinkedIn Data Export CSVs

These come from LinkedIn's "Download your data" feature (`Basic_LinkedInDataExport_*.zip`).

| File | Key Columns | Use in Dashboard |
|------|-------------|------------------|
| `Connections.csv` | First Name, Last Name, URL, Email, Company, Position, Connected On | Network analysis, connection growth timeline, company distribution |
| `Profile.csv` | First Name, Last Name, Headline, Summary, Industry, Geo Location | Profile info display |
| `Positions.csv` | Company Name, Title, Description, Location, Started On, Finished On | Career timeline |
| `Skills.csv` | Name | Skills cloud |
| `Invitations.csv` | From, To, Sent At, Message, Direction, inviterProfileUrl | Invitation activity tracking |
| `Endorsement_Received_Info.csv` | Date, Skill Name, Endorser First/Last Name, URL, Status | Endorsement analysis |
| `Endorsement_Given_Info.csv` | Date, Skill Name, Endorsee First/Last Name, URL, Status | Endorsement analysis |
| `Learning.csv` | Content Title, Description, Type, Last Watched, Completed At | Learning activity |
| `messages.csv` | Conversation ID, Title, From, To, Date, Subject, Content, Folder | Message activity (private, not displayed publicly) |
| `Rich_Media.csv` | Date/Time, Media Description, Media Link | Media tracking |
| `Company Follows.csv` | Company follows | Company interests |

### SinglePostAnalytics XLSX Files

Downloaded from LinkedIn's post analytics UI. Each file contains detailed metrics for one post, including the demographic breakdowns. Naming convention: `SinglePostAnalytics_Pedro Ripper_{activity_id}.xlsx`

Currently 21 files covering posts from 2021-2026.

### AggregateAnalytics XLSX Files

Downloaded from LinkedIn's profile analytics. Contains daily/weekly aggregate metrics over a date range. Naming convention: `AggregateAnalytics_Pedro Ripper_{start_date}_{end_date}.xlsx`

Currently 2 files covering the 12-month period.

## Dashboard Pages — Detailed Specs

### 1. Executive Summary (`/`)

**Purpose**: Quick-glance daily check — "how am I doing?"

**Metrics displayed**:
- Total followers (10,174) with 12mo growth (+2,900, +39.8%)
- Total impressions (367,901) with monthly average
- Total engagements (10,200) with average engagement rate
- Profile views trend
- Followers gained this month vs. last month
- Last 7 days sparkline: impressions + engagements
- Top 3 performing posts (by impressions) in last 30 days
- Daily engagement chart (from `daily_engagement` array) — full 12-month timeline with zoom

### 2. Post Performance Explorer (`/posts`)

**Purpose**: The workhorse — find, filter, sort, and analyze any post.

**Features**:
- Table view of all 31 posts, sortable by any metric
- Columns: Date, Topic, Impressions, Engagement Rate, Reactions, Comments, Reposts, Saves, Followers Gained, Data Source
- Filters: topic, style, image type, date range, has_link, has_image, feature_count range
- Click any row to expand inline: full post text, demographic charts, engagement funnel
- Color-coded performance: green (above average), yellow (average), red (below average)
- CSV export button

### 3. Individual Post Deep-Dive (`/posts/[id]`)

**Purpose**: Full analysis of a single post.

**Sections**:
- **Full post viewer** (Phase 9, planned) — renders the complete post body with Unicode bold characters displayed as bold, line breaks preserved, emojis inline. Media (images + videos) embedded via LinkedIn's iframe in v1; v2 will render media directly once the extension starts capturing media URLs.
- Post content preview with feature badges (has_link, has_emoji, etc.)
- **"Analyze this post" button** (Phase 9, planned) — runs a Claude call that dissects the post using the `skills/example-linkedin-writer.md` skill file and returns structured feedback: what worked, what could improve, rewrite suggestions, and a "lesson to remember" the user can promote into the skill. Streams tokens live into the panel.
- Engagement funnel: Impressions → Reached → Engagements → Reactions → Comments → Reposts → Saves → Sends
- Demographic breakdown (6 charts): job title, location, seniority, company, industry, company size
- Performance vs. average (how this post compares to your overall averages)
- Similar posts comparison (same topic/style)

### 4. Content Optimization Engine (`/optimization`)

**Purpose**: Data-driven answers to "what should I post?"

**Visualizations**:
- **Image type impact**: Bar chart showing avg impressions by image_type (photos with people +280%)
- **Feature stacking**: Line chart showing impressions by feature_count (0-5+)
- **Word count curve**: Scatter plot of word_count vs. impressions with trend line (sweet spot: 150-200)
- **Link penalty**: Side-by-side comparison — posts with links vs. without (-47% reach)
- **Question placement**: Body questions (8,815 avg) vs. title-only questions (3,406)
- **Posting heatmap**: Day of week × time of day grid showing optimal slots (Friday 6:50 PM)
- **Topic performance**: Grouped bar chart — avg impressions, engagement rate, followers gained by topic
- **Style performance**: Same breakdown by post style
- **Emoji impact**: With vs. without
- **Bold Unicode impact**: With vs. without

### 5. Audience Intelligence (`/audience`)

**Purpose**: Understand who's consuming your content.

**Visualizations** (aggregated across all posts with demographics):
- **Geographic distribution**: Map or treemap of locations (São Paulo 34%, Rio 20%, etc.)
- **Seniority pyramid**: Distribution chart (54% senior+)
- **Industry breakdown**: Horizontal bar chart
- **Company distribution**: Top companies engaging with content
- **Job title cloud**: Weighted by frequency
- **Company size distribution**: Donut chart
- **Per-post audience comparison**: Select any post and see how its audience differs from average

### 6. Growth Tracker (`/growth`)

**Purpose**: Track trajectory and identify growth drivers.

**Visualizations**:
- **Follower growth timeline**: Line chart showing cumulative followers over 12 months with post markers
- **Monthly impressions trend**: Bar chart with month-over-month % change
- **Engagement rate evolution**: Are you getting better over time?
- **Posting frequency vs. growth**: Correlation between post cadence and follower gains
- **Best posts for growth**: Ranked by followers_gained (not impressions)
- **Daily engagement heatmap**: Calendar view of daily impressions from daily_engagement data

### 7. Network & Connections (`/network`)

**Purpose**: Understand your LinkedIn network composition.

**Visualizations**:
- **Connection growth timeline**: When connections were added (from Connected On dates)
- **Company distribution**: Top companies in your network
- **Role distribution**: Job titles/positions of connections
- **Invitation activity**: Outgoing invitations over time
- **Endorsement analysis**: Skills most endorsed, top endorsers
- **Network overlap with audience**: Do the people engaging with your posts match your connections?

### 8. Post Comparison Mode (`/compare`)

**Purpose**: Side-by-side analysis of any two posts.

**Features**:
- Two dropdown selectors to pick posts
- Side-by-side metric cards: impressions, engagement rate, reactions, comments, saves, followers
- Overlaid demographic charts showing audience differences
- Feature comparison: which content features did each post have?
- "Why did this one win?" AI-generated insight based on feature differences (static analysis, not AI API call)

### 9. Pre-Publish Content Scorecard (`/checklist`)

**Purpose**: Before you hit publish, score your draft against proven patterns.

**Interactive checklist** (scored 0-100):
- [ ] Photo with people attached? (+280% impressions)
- [ ] Bold Unicode headers used? (+XX%)
- [ ] Emoji included? (+XX%)
- [ ] Question in post body? (8,815 avg vs. 3,406)
- [ ] No outbound links in body? (-47% if included)
- [ ] Word count 150-200? (optimal range)
- [ ] Structured with bullet points/lists? (+XX%)
- [ ] Publishing on Friday evening? (best time slot)
- [ ] Topic is Payments/Fintech or AI/Tech? (highest performers)
- [ ] 5+ content features stacked? (760% more impressions)

Dynamic score updates as boxes are checked. Shows predicted impression range based on historical data.

## Data Sync Strategy

### How to Add a New Post

**Option A — Quick manual entry (via Claude Code):**
```bash
# From the project root, tell Claude:
"Add my new LinkedIn post to the analytics. Activity ID: XXXXX. Here are the metrics: [paste from LinkedIn]"
# Claude reads the JSON, adds the new post entry, validates, and commits.
```

**Option B — Import from SinglePostAnalytics XLSX:**
1. Download the XLSX from LinkedIn's post analytics page
2. Drop it into `data/single-post-analytics/`
3. Run: `npm run import:post -- --file="SinglePostAnalytics_Pedro Ripper_XXXXX.xlsx"`
4. The script parses the XLSX, extracts all metrics + demographics, and appends to `linkedin_analytics_master.json`
5. Commit and push — Vercel auto-deploys

**Option C — Import aggregate data:**
1. Download AggregateAnalytics XLSX from LinkedIn
2. Drop into `data/aggregate-analytics/`
3. Run: `npm run import:aggregate -- --file="AggregateAnalytics_Pedro Ripper_XXXX.xlsx"`
4. Updates `daily_engagement` array with new daily entries

### How to Update LinkedIn Export Data

1. Go to LinkedIn Settings → "Get a copy of your data" → Request archive
2. Download the ZIP when ready
3. Extract CSVs into `data/linkedin-export/` (overwrite existing)
4. Run: `npm run import:export`
5. Commit and push

## Daily Ingest Pipeline

LinkedIn exposes no public API for personal analytics. After evaluating alternatives, the chosen approach mimics how Shield / Inlytics / AuthoredUp work: a personal browser extension captures LinkedIn's internal Voyager API responses from your own authenticated session and POSTs them to our backend. Phases 1 through 5 of the pipeline are live in production at `https://linkedin-analytics-topaz.vercel.app`; Phase 3d is the remaining work to deliver the Core Objective (see above).

**Risk:** this mimics Shield et al., which technically violate LinkedIn's User Agreement §8.2 (automated access). Pedro has accepted the account-restriction risk for personal-use, low-volume, own-account extraction. Documented so the decision isn't relitigated.

### Architecture

- **Chrome MV3 browser extension** — MAIN-world content script intercepts Voyager `fetch`/`XHR` calls on `linkedin.com/*` via `Object.defineProperty` traps (so LinkedIn's apfc bundle can't re-assign past our patches). Background service worker runs a daily `chrome.alarms` tick that fetches Pedro's profile page HTML to scrape the follower count, then POSTs captured payloads to `/api/ingest`.
- **Vercel Function** `POST /api/ingest` — shared-secret-authenticated endpoint, validates with Zod, upserts into Supabase. Every attempt writes an `ingest_log` row (success or failure + error text).
- **Supabase Postgres** (via Drizzle ORM) — `posts` (metadata), `post_snapshots` (daily time-series per post), `post_demographics` (per-post audience mix), `profile_snapshots` (daily follower/connection totals), `profile_demographics` (profile-level audience mix from the xlsx export), `daily_engagement` (daily impressions/engagements rollup), `ingest_log`.
- **Transaction pooler** (Supabase port 6543 / pgbouncer) — required for Next.js + Vercel; the Session pooler (5432) blows through its connection cap under concurrent requests. `src/db/client.ts` auto-rewrites the URL and sets `prepare: false`.
- **`/api/health`** — public JSON endpoint with DB reachability, last-ingest recency, and a 7-day post-capture count. Doubles as the data source for a homepage "last captured Xh ago" pill.
- **Vercel Blob** (future, Phase 3d or later) — mirrors post media so assets survive even if LinkedIn rotates CDN URLs or restricts the account.

### DB schema source of truth

`src/db/schema.ts` (Drizzle) is authoritative for the database shape. Do **not** hand-edit tables in Supabase; schema changes flow through `npm run db:generate` → commit generated SQL → `npm run db:migrate`.

### Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Supabase provisioned; Drizzle schema + migration; seed script from legacy JSON; vitest coverage | ✅ done (commit `f653897`) |
| 2 | `POST /api/ingest` Vercel Function with shared-secret auth + Zod validation; Next.js moved off static export | ✅ done (commit `d5094ec`) |
| 3a | Chrome MV3 extension Voyager capture (impressions, reactions, comments, reposts) | ✅ done (commit `64f644a`) |
| 3b | Daily profile-level capture — followers via server-rendered HTML scrape; connections via interceptor (opportunistic) | ✅ done (commit `aeb1aea`) |
| 3c | Historical backfill from LinkedIn's self-service exports — 13 months of daily follower totals, daily engagement, profile demographics, 125 historical post metadata rows | ✅ done (commit `779fe2c`) |
| 3d | **Comprehensive per-post analytics** — Core Objective. Capture full metric set (saves, sends, followers_gained, profile_viewers, link_clicks, per-post demographics, full reaction breakdown) for every post; autonomous capture for new posts + rolling backfill for the last 2 years. Detailed plan below. | ✅ mostly done (~50/66 captured; ~16 pending pool-grow as backfill resumes after LinkedIn cool-down) |
| 4 | Dashboard reads from Supabase (async queries via `src/lib/queries.ts`); 13-month follower-growth chart on `/growth`; legacy `@/lib/data.ts` retired | ✅ done (commit `b9b0cf2`) |
| 5 | `/api/health` + homepage "last capture" freshness pill backed by `ingest_log` | ✅ done (commit `fdc874a`) |
| QA | DB audit, pool-exhaustion fix (Transaction pooler), home/optimization metric bias fixes | ✅ done (commit `7d95a2d`) |
| 5b | Dashboard polish: range filter, three range-aware charts, KPI reorder around the causal cascade, EMV moved to its own page, /compare tornado layout + content scorecards + Best/Worst shortlists, Monthly Breakdown trimmed | ✅ done |
| 5c | Quality / safety: Supabase RLS enabled on all tables, defensive read of latest non-null follower count, ID resolver for legacy share/ugcPost URNs (rescued ~83 posts), Vercel Blob store provisioned | ✅ done |
| 6 | **Networking intelligence** — secondary initiative. **Hybrid model: Connections.csv (nominal layer) + post demographics (aggregate followers layer).** No active scraping — exports are imported manually on a periodic cadence. See "Secondary Initiative" section below. | ⏳ pending (starts after UI fixes + data backlog catch-up) |
| 7 | **Engagement attribution** — intercept reactor/commenter URNs per post, cross-reference Connections.csv to flag which target-company contacts engage with which content. | ⏳ pending (after 6) |
| 8 | **Target-company gap recommender** — scrape LinkedIn People Search, diff against Connections.csv, produce "who to reach out to" list. Heavier ToS exposure. | ❓ maybe-never (only if 6+7 prove value) |
| 9 | **Content Intelligence** — full-post viewer on `/posts/[id]`, Claude-powered post analysis against a version-controlled skill file, and periodic validation of the skill's rules against real post-performance data ("dynamic guideline"). See section below. | 🟡 9.A v1 partially shipped — full post viewer + heuristic interpretive cards live; Claude-driven analysis still parked |

### Phase 3d — Comprehensive Per-Post Analytics (mostly done, in cool-down)

Goal: for every post we can still pull data for, fill a complete `post_snapshots` row with all metrics LinkedIn exposes per post, plus a full `post_demographics` block.

**State as of May 2026**: ~50/66 reachable posts have complete snapshots (impressions + saves + sends + profile_viewers + followers_gained + reactions full breakdown). 58 historical posts are unreachable because they pre-date LinkedIn's 24-month analytics retention window. Remaining ~16 are paused mid-backfill — LinkedIn applied a cumulative throttle after the most recent run, so we're holding off until the cool-down clears (typically days).

Two parser fixes shipped along the way that are worth recording:

- **Label-first layout (April 2026)**: LinkedIn flipped the Discovery / Profile activity blocks from `"NUMBER LABEL"` to `"LABEL NUMBER"`, which silently shifted impressions/profile_viewers into adjacent columns in our DB. Detector + dual-mode parser handles both layouts now, with regression test fixed against a live page sample.
- **Legacy URN resolver**: 83 of the 87 posts that had `urn:li:share:` / `urn:li:ugcPost:` URLs (from the original JSON seed) were rewritten to their real `urn:li:activity:` URNs via an extension-driven orchestrator. The remaining 3 are posts LinkedIn no longer serves and are marked with a 24h cooldown to keep them out of the backfill queue.

**Success criteria**:
- **Every new post**: full metric set captured within 48 hours of publishing. Zero manual steps.
- **Last 24 months of posts**: ≥75% have complete snapshot data after backfill.
- **Posts older than ~24 months**: metadata-only is accepted (LinkedIn's analytics retention window).

**Sub-phases**:

- **3d.A — Reconnaissance** ✅ done. Recon confirmed LinkedIn exposes the gap fields (saves, sends, followersGained, profileViewers, linkEngagements) EXCLUSIVELY in RSC-rendered HTML on `/analytics/post-summary/urn:li:activity:<id>/`. No Voyager JSON endpoint carries them and no batch endpoint exists.

- **3d.B — Parser + capture wiring** ✅ done. Pure-function DOM scraper + ingest schema loosened to accept metadata-free snapshot captures + extension content-script scrapes post-summary pages and merges with feed captures by activityId before POST.

- **3d.C-core — Orchestrator mechanism** ✅ done. Background orchestrator opens hidden tabs, waits for the content-script capture, closes, rate-limits with jittered delays between posts. **Migrated to `chrome.alarms`-based chain** (each tick = independent SW invocation) after the original in-memory loop kept dying when MV3 killed the service worker mid-sleep. Hard abort guards: 2 consecutive throttles OR 2 consecutive timeouts OR `completed > total + 5` runaway cap.

- **3d.D — Historical backfill** 🟡 in-progress. Endpoint `/api/posts-needing-capture` returns the queue (activity-URN-only, excluding share/ugcPost). Options-page "Backfill now" + "Stop backfill" buttons drive it. ~50/66 captured; ~16 pending after LinkedIn cool-down. Forward captures continue feeding into the same tables daily.

- **3d.C-forward — Daily automation** ✅ done. Wired into the daily `chrome.alarms` tick — new posts published forward get captured automatically; the `/api/ingest` endpoint also runs every 24h via the same alarm. Zero user clicks for the steady state.

**Execution order chosen**: C-core → D → C-forward. C-core had to land first to support D, but C-forward is now also live so any post Pedro publishes shows up in the dashboard within ~24h without intervention.

### Phase 9 — Content Intelligence

Goal: turn `/posts/[id]` from a metrics dashboard into a coaching surface. Pedro should be able to read the full post in context, run an AI critique against his personal writing rubric ("skill"), and — over time — have that rubric kept honest by the data instead of drifting into opinion.

The initiative has three tracks: the v1 feature shipped as an MVP, the v2+ ideas parked to avoid losing them, and the "dynamic guideline" validation layer that makes the skill empirical rather than static.

#### 9.A — v1 (MVP)

**Status — May 2026**: shipped *without* the LLM step. The page exists, renders the full post and media, and surfaces interpretive cards driven by heuristic statistics. The Claude-based analysis is the parked piece.

What's live:
- **Full post viewer on `/posts/[id]`** — `post_content` rendered with `whitespace: pre-wrap` so math-bold Unicode displays bold, line breaks preserved, hashtags and emojis inline. Media now comes from `post_media` (populated by the ingest pipeline) and is served from Vercel Blob when mirrored, falling back to the LinkedIn CDN URL otherwise.
- **"Why this post performed this way" panel** — up to ~6 interpretive cards driven by heuristic stats: percentile rank vs the captured pool (followers gained, ER), cohort comparison (matched by topic + image/question/bullets), feature-signal callouts (external link is a hit, image+question+bullets is a stack, no visual hooks at all is a flag).
- **Top 5 / Worst 3 entries on `/compare`** link directly to `/posts/[id]`, so the shortlist is also a jumping-off point.

What's still parked (will resume when the heuristic version surfaces gaps):
- **Skill file**: `skills/example-linkedin-writer.md` — imported verbatim from Pedro's existing Claude Code writing skill (voice, structure, formatting, themes, post types, signature phrases). Single source of truth — the same file would be used by Claude Code when drafting posts AND by the dashboard's analyst endpoint when evaluating them.
- **Analyze endpoint**: `src/app/api/analyze-post/[id]/route.ts` (Node runtime) — loads the skill (with prompt caching on the stable system prefix), composes context (post content + its own metrics + median metrics for same topic/style as comparison baseline), calls `claude-opus-4-7` with adaptive thinking, `effort: medium`, and Zod-structured output shaped as `{ what_worked, what_could_improve, rewrite_suggestions, lesson_to_remember }`. Streams deltas.
- **Page wiring**: "Analyze this post" button on `/posts/[id]`; click opens a streaming panel beneath the metrics column. Output in Portuguese by default (Pedro's primary posting language) with an EN toggle.
- **Feedback loop — manual for v1**: the `lesson_to_remember` field is a one-paragraph takeaway. Pedro copies the useful ones into the skill file. Prevents "Claude invents rules from a single data point" overfitting.

The reason for parking the LLM step: the heuristic interpretive cards already cover ~70% of the analytical value (percentile, cohort delta, feature callouts) at zero cost and zero failure modes. The LLM layer is the remaining 30% — qualitative writing critique. We'll add it once we hit a use case the heuristics can't answer.

#### 9.B — v2+ ideas (parked, do not lose)

Captured here so we remember to revisit after v1 is in use and we understand what actually hurts.

- **Direct media rendering** — replace the LinkedIn iframe with our own UI once `post_media` is populated. Requires extending the Chrome extension to capture media URLs (and possibly mirror to Vercel Blob so assets survive LinkedIn CDN rotation). Deferred because the iframe covers ≥80% of the v1 value for ~0% of the work.
- **DB-backed skill** — move from markdown-in-repo to a `skill_notes` table editable in a dashboard UI (history, tags, confidence scores per rule). Only worth it when the markdown file starts exceeding a few hundred lines or when we want collaborators.
- **Similarity-aware comparison** — in addition to median-of-same-topic, pull the top N posts whose content embeddings are closest to the target post. Lets Claude say "your post most resembles X and Y from 2025, which both went to 8k+ impressions — here's the difference."
- **Semi-automatic rule generation** — after each analysis Claude also proposes 1–2 candidate rule additions into a `skills/pending-rules.md` file. Pedro reviews and promotes. Not in v1 because human gate is the safer default until we've seen the failure modes.
- **Inline rewrite mode** — show the original post and a Claude-suggested rewrite side by side with a diff, so feedback is actionable in one click. Nice ergonomics upgrade once v1 proves useful.
- **Cross-post retrospectives** — monthly rollup: "here are the 5 posts that overperformed; here's what they have in common according to your skill." Lives in `/optimization` rather than the per-post view.

#### 9.C — Dynamic Guideline Validation

The core concern: a skill file is just a collection of opinions unless we can check it against real data. Rules that sound right ("questions in the hook increase engagement") may or may not hold up against Pedro's actual post performance. Without validation, the skill drifts into aesthetics, and Claude's analyses become circular ("this post violates rule X" where rule X is itself unsupported).

**Design — tagged rules in the skill file**

Every testable rule in `skills/example-linkedin-writer.md` carries an embedded, machine-readable block alongside its prose:

```markdown
## Hook strength
Posts that open with a question or a surprising statistic tend to outperform
posts that open with throat-clearing.

<!-- @rule hook_question
hypothesis: posts whose first paragraph contains '?' achieve higher
  engagement_rate than those that don't.
segment: posts with impressions > 1000 from the last 18 months.
test: compare mean(engagement_rate) across the two buckets.
floor: require >= 10 posts in each bucket and >= 1.2x ratio.
-->
```

Prose is for Claude (and humans). The `@rule` block is for the validator.

**Validator**

A script (`scripts/validate-skill.ts`) reads every `@rule` block from the skill file, translates each into a SQL query against the `posts` + `post_snapshots` tables, runs it, and emits a markdown report `skills/validation-report.md`:

```
@rule hook_question: CONFIRMED (1.4x mean engagement rate, n=23 vs 41)
@rule bold_unicode_opener: REFUTED (0.9x, n=18 vs 46 — remove or revise)
@rule short_post: INSUFFICIENT_DATA (only 3 posts under 100 words)
```

The report is committed to the repo, so Pedro can see the history of validations over time as new data lands. A verdict of REFUTED flags the rule for removal or revision on Pedro's next skill edit — but the script never edits the skill itself; human in the loop, same principle as 9.A.

**Cadence**

- **On-demand**: `npm run validate-skill` locally whenever Pedro edits the skill.
- **Scheduled**: a Vercel Cron hits an endpoint that runs the validator once a month, commits the updated `skills/validation-report.md` via a GitHub App, and opens a PR titled "skill validation — April 2026".

**How validation feeds the analysis endpoint**

The `/api/analyze-post/[id]` call loads BOTH the skill prose AND the latest `validation-report.md`. Claude's system prompt tells it: "For each rule you cite in your critique, note whether the rule is CONFIRMED, REFUTED, or UNVALIDATED by Pedro's data, and weight your advice accordingly — REFUTED rules should be ignored or noted as a historical guess rather than current truth." This is what makes the guideline *dynamic*: the skill's authority over the analysis is empirical, not editorial.

**Sub-phase sequencing**

- **9.A** first (ship the visible MVP, collect user feedback).
- **9.C** second, in two passes: first the on-demand validator + report format, then the scheduled cron + PR-based workflow. Designing the skill file with tagged rules from day 1 means 9.A doesn't have to be refactored when 9.C lands.
- **9.B** items pulled in opportunistically as the value becomes clear from using 9.A + 9.C.

## Secondary Initiative: Networking Intelligence (Phase 6+)

Distinct from the Core Objective (post-content optimization) but in the same "your-own-data, self-hosted" spirit. Driving question:

> "Am I connected to enough influential people at the companies that matter for my business — and how is that coverage trending over time?"

Deliberately split into tiers, to be executed **only after the current UI fixes + remaining backfill catch-up** so it doesn't distract from per-post analytics.

### Universe choice: followers, not just connections

Pedro's intuition was that **followers** (~10,341) — not just **connections** (~4,894) — is the right universe for "who sees and is impacted by my content." Connections are bidirectional and a strict subset; every connection auto-follows (unless they opt out), but the inverse isn't true. ~5,400 followers are NOT connections, and they matter for content reach analysis.

**LinkedIn export reality check** (researched May 2026): the data Pedro can pull officially is asymmetric.

| Universe | Nominal list (names + companies + titles)? | Aggregate demographics? |
|---|---|---|
| Connections (~4,894) | ✅ via `Connections.csv` (Settings → Data privacy → Get a copy of your data → ~10 min) | derivable from CSV |
| Followers nominal (~10,341) | ❌ LinkedIn does NOT expose individual follower lists in personal-account exports | n/a |
| Followers aggregate | n/a | ✅ already captured per-post in `post_demographics` (top companies, industries, locations, seniority that viewed each post) |

So Phase 6 has to be **hybrid**:

- **Nominal layer** — connections only. Imported from `Connections.csv` periodically (quarterly or whenever Pedro feels his network has shifted). Manual upload via a new endpoint.
- **Aggregate layer** — followers + non-connection viewers — comes for free from the per-post demographics we already capture. We can roll those up across posts to estimate follower-side coverage by company, industry, etc., without ever knowing individual names.

### Tier 1 — Target-company coverage dashboard (Phase 6)

No active scraping, no new extension work. All data from existing exports + already-captured demographics.

- **Target-company list**: Pedro defines a config (manual list, ~50–200 companies — partners, clients, ecosystem, competitors, prospects). Stored as a config file in repo or a small `target_companies` table.
- **Connections.csv import**: new endpoint `/api/import-connections` accepts the CSV file (schema: First Name, Last Name, URL, Email, Company, Position, Connected On). Persists into a `connections` table. Replace-on-upload semantics — rerunning a fresh export overwrites the prior import. Also captures connection-history deltas so we can show "connections added in the last 90 days".
- **Coverage analysis (nominal)**:
  - For each target company: total connections, **seniority mix** inferred from position titles (C-level / VP / Director / Manager / IC), **growth trend** (connections added this month / quarter / year), and a flat list of "who I know there" sorted by seniority.
  - Single "coverage score" per target (weighted count of senior connections).
- **Coverage analysis (aggregate)**:
  - For each target company: roll up post-demographic mentions across all captured posts to estimate **follower-side mass** ("X% of impressions in the last 90 days came from people at this company"). Approximate but useful for prospects where Pedro has 0 connections but the audience does engage.
- **UI**: new `/coverage` page (or section under `/network`) — table of target companies with both nominal and aggregate columns side by side, gap analysis at the bottom (zero-or-low-coverage targets surface for outreach).
- **Cadence**: Pedro re-uploads `Connections.csv` quarterly. Aggregate layer auto-updates daily as new post captures land.

Estimated effort: ~1–2 days after the UI fixes round.

### Tier 2 — Engagement attribution (Phase 7)

Builds on top of Tier 1's `connections` table.

- LinkedIn's Voyager returns **reactor** and **commenter** URNs per post (this is how the feed's "3 reactions from your network" UI pulls names). Intercept that endpoint via the existing extension interceptor.
- Cross-reference reactor URNs against `connections` to flag: "this post was engaged with by N people at target companies — here's who." Extend `post_snapshots` or add a joined table.
- Dashboard overlay: highlight on `/posts/[id]` which target-company contacts engaged.
- Gives Pedro direct feedback: "this content style resonates with my Bemobi contacts, that one with the Telefônica side."

### Tier 3 — Gap-to-target recommender (Phase 8, maybe never)

Replicates the key feature of Sales Navigator ($99/mo).

- Scrape LinkedIn People Search results per target company (same extension pattern, same ToS category).
- Diff against Pedro's existing connections list.
- Output: prioritized "people to reach out to" list per target company, ranked by seniority.
- Only pursue if Tiers 1 and 2 prove the networking angle is valuable AND Pedro wants to push further. Defer indefinitely otherwise.

### Legacy manual import (pre-Phase-3c)

Kept for reference. The extension + xlsx backfill now cover everything:

- Add a post by hand to `data/linkedin_analytics_master.json` and run `npm run db:seed` to push into Supabase.
- Or: download SinglePostAnalytics XLSX from LinkedIn → import via the legacy scripts listed above → then re-seed.

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Getting Started
```bash
git clone https://github.com/YOUR_USERNAME/linkedin-analytics.git
cd linkedin-analytics
npm install
npm run dev        # http://localhost:3000
```

### Scripts
```bash
# Dev / build
npm run dev           # Start development server
npm run build         # Next.js production build

# Database (Supabase via Drizzle)
npm run db:generate   # Generate migration SQL from schema changes
npm run db:migrate    # Apply pending migrations to Supabase
npm run db:push       # Push schema directly (dev shortcut; prefer generate+migrate)
npm run db:seed       # Idempotently import legacy JSON → Supabase
npm run db:studio     # Open Drizzle Studio for visual DB browsing

# Tests
npm run test          # Run vitest once
npm run test:watch    # Watch mode
npm run test:coverage # Run with v8 coverage report

# Legacy imports (pre-Phase-3; listed in the project structure above)
# npm run import:post, import:aggregate, import:export, validate
# — still valid until the daily ingest pipeline replaces them.
```

### Deployment
```bash
# Option 1: Auto-deploy via GitHub
git push origin main   # Vercel rebuilds automatically

# Option 2: Manual deploy
npx vercel --prod
```

## CLAUDE.md Guidelines

When working on this project with Claude Code:

1. **Data updates (legacy)**: When editing `data/linkedin_analytics_master.json` pre-Phase-3, validate with `node -e "JSON.parse(require('fs').readFileSync('data/linkedin_analytics_master.json','utf8'))"` and follow up with `npm run db:seed` to keep Supabase in sync.
2. **Schema changes**: Drizzle is the source of truth. Edit `src/db/schema.ts` → `npm run db:generate` (commit the generated SQL in `drizzle/`) → `npm run db:migrate`. Do not hand-edit tables in the Supabase UI.
3. **New features**: Pre-Phase-4, keep following the `lib/data.ts` + `lib/calculations.ts` + `lib/types.ts` pattern. Post-Phase-4, page components will query Supabase directly via `src/db/client.ts`.
4. **Charts**: Use Recharts consistently. Dark/light mode colors live in `constants.ts`.
5. **API access policy**: No LinkedIn official API (it doesn't expose personal analytics), no scraping from servers. Data enters this system via legacy manual imports or, once Phase 3 ships, the personal browser extension → `/api/ingest`. Supabase and Vercel Blob are internal-only backends, not public APIs.
6. **Secrets**: `DATABASE_URL` and the (future) ingest shared secret live in `.env.local` and Vercel env vars. Never commit.
7. **Server-side DB only**: `src/db/client.ts` must never be imported into a `'use client'` boundary.
8. **Privacy**: This repo is private. Data including messages and connections stays in the repo and in Pedro's personal Supabase project.

## Competitive Positioning

| Feature | Shield ($8-25/mo) | Taplio ($39-149/mo) | This Dashboard (Free) |
|---------|-------------------|--------------------|-----------------------|
| Post-level metrics | Yes | Yes | Yes |
| Per-post demographics | Paid tier | No | Yes (all 20 official posts) |
| Daily engagement timeline | Yes | No | Yes (365 days) |
| Content optimization engine | No | Basic tips | Full visual analysis |
| Engagement funnel per post | No | No | Yes |
| Feature stacking analysis | No | No | Yes |
| Earned media value | Yes | No | Yes |
| Post comparison mode | No | No | Yes |
| Pre-publish scorecard | No | No | Yes |
| Network analysis | No | No | Yes |
| Offline / self-hosted | No (SaaS) | No (SaaS) | Yes |
| Recurring cost | $96-300/year | $468-1,788/year | $0 |
| Data ownership | Theirs | Theirs | Yours |
