# LinkedIn Voyager Reconnaissance Report

> Captured 2026-04-18 via a browser-agent session on your own logged-in
> LinkedIn account. Pure observation — no automated requests, no interactions
> (likes / comments / follows). This document drives Phase 3 of the Daily
> Ingest Pipeline (see `PROJECT.md`).

## Session metadata

- Captured at: 2026-04-18 (during session)
- CSRF token present: yes — it's the value of the `JSESSIONID` cookie, format `ajax:<digits>` (24 chars total in this session). Not copied.
- Session cookies observed by name only: `JSESSIONID`, `liap`, `lidc`, `li_mc`, `bcookie`, `li_sugr`, `li_theme`, `li_theme_set`, `lang`, `PLAY_LANG`, `g_state`, `timezone`, `sdui_ver`, `at_check`, `lms_ads`, `lms_analytics`, `_guid`, `_gcl_au`, `_pxvid`, `_px3`, plus Adobe/marketing cookies. No `li_at` was exposed to JS (HttpOnly).

## Key architectural finding (read this first)

LinkedIn's Creator Analytics pages have been rewritten as React Server Components (RSC) / Server-Driven UI (SDUI). The browser no longer fetches clean Voyager JSON for these screens. Instead it POSTs to:

- `POST /flagship-web/rsc-action/actions/component` — fetches a rendered component tree
- `POST /flagship-web/rsc-action/actions/server-request` — fetches data (e.g. `caSlowMetrics`)

The responses are RSC streams (`1:I["..."]…0:{"response":{...}}`) that mix pre-rendered React nodes with embedded data. The raw metrics (e.g. `{"y":87780,"x":1776384000000}` for chart points) are present but interleaved with presentation nodes; there is no longer a Voyager endpoint like `voyagerAnalyticsDashCreatorMetrics` exposed to the client.

Three classes of endpoints still exist:

1. **RSC/SDUI POST endpoints** (new analytics pages)
2. **Classic Voyager GraphQL endpoints** (profile pages, recent-activity feed, my-network, messaging)
3. **Classic Voyager REST endpoints** (relationships summary, me)

This matters a lot for the extension strategy (see end of report).

## Endpoints by page

### 1. `/analytics/creator/` (redirects to `/dashboard/`) — Overview

This URL now 302s to `/dashboard/`. The dashboard page ships its Voyager payload embedded in the HTML via `<code id="bpr-guid-…">` tags paired with `<code id="datalet-bpr-guid-…">` tags that describe the origin request. No XHR call fires for the overview metrics — they're server-rendered.

- **Endpoint:** `GET /voyager/api/graphql` with `queryId=voyagerFeedDashCreatorExperienceDashboard.6fcd24af6f10cdcd1cd7d8e747df3276`
- **Purpose:** creator dashboard cards (post impressions, followers, profile viewers, search appearances)
- **Required headers (when replayed from client):** `csrf-token`, `accept: application/json`, `x-restli-protocol-version: 2.0.0` (also observed `x-li-lang`, `x-li-track` on SPA-initiated calls)
- **Response shape (truncated):**

```json
{ "data": { "data": { "feedDashCreatorExperienceDashboard": {
    "header": { "title": {"text":"Analytics & tools"}, "description": {"text":"Saturday, April 18"} },
    "section": [ { "analyticsSection": { "analyticsPreviews": [
        { "analyticsTitle":{"text":"15,269"}, "description":{"text":"Post impressions"},
          "changeDateRange":{"text":"past 7 days"}, "changeInValue":{…},
          "navigationUrl":"https://www.linkedin.com/analytics/creator/content/…" },
        { "analyticsTitle":{"text":"10,228"}, "description":{"text":"Followers"}, … },
        { "analyticsTitle":{"text":"2,251"}, "description":{"text":"Profile viewers"}, … },
        { "analyticsTitle":{"text":"338"},   "description":{"text":"Search appearances"}, … }
    ] } } ]
  } } } }
```

Key fields (the values come as formatted display strings, not raw ints):

- `…feedDashCreatorExperienceDashboard.section[0].analyticsSection.analyticsPreviews[0].analyticsTitle.text` → Post impressions (7d default)
- `…analyticsPreviews[1].analyticsTitle.text` → Current follower count
- `…analyticsPreviews[2].analyticsTitle.text` → Profile viewers (90d)
- `…analyticsPreviews[3].analyticsTitle.text` → Search appearances
- `…analyticsPreviews[i].changeInValue.text` → % change label

**How the extension should consume this:** either (a) parse the `<code id="bpr-guid-1100294">` JSON out of the Dashboard HTML, or (b) replay the GraphQL query above with the same queryId + `includeWebMetadata=true` + empty variables.

### 2. `/analytics/creator/content/` — Content analytics

No Voyager endpoint is called from the client. The page fires RSC calls:

- **Endpoint A:** `POST /flagship-web/rsc-action/actions/component?componentId=com.linkedin.sdui.generated.creator.analytics.dsl.impl.contentAnalyticsContent&sduiid=…&parentSpanId=…`
- **Endpoint B:** `POST /flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.creatoranalytics.caSlowMetrics&parentSpanId=…`
- **Purpose:** A renders the page shell + chart; B fills in demographics/members-reached "slow" metrics
- **Required headers:** `csrf-token`, `x-li-rsc-stream`, `x-li-page-instance`, `x-li-page-instance-tracking-id`, `x-li-application-instance`, `x-li-application-version`, `x-li-anchor-page-key`, `x-li-track`, `Content-Type: application/json`
- **Request body (B example):**

```json
{ "requestId":"com.linkedin.sdui.requests.creatoranalytics.caSlowMetrics",
    "serverRequest": { "requestId":"com.linkedin.sdui.requests.creatoranalytics.caSlowMetrics", … },
    "states": [
      { "key":"content_analytics_state_start_date_binding", "namespace":"MemoryNamespace",
        "originalProtoCase":"dateValue", "value":{"$type":"proto.sdui.common.Date","year":2026,"month":3,"day":22} },
      { "key":"content_analytics_state_end_date_binding", "namespace":"MemoryNamespace",
        "originalProtoCase":"dateValue", "value":{"$type":"proto.sdui.common.Date","year":2026,"month":4,"day":18} },
      { "key":"topPostLeafPageUrl", "namespace":"MemoryNamespace", "originalProtoCase":"stringValue", "value":"…" }
    ]
  }
```

**Response:** RSC stream, ~140–380 KB. Summary cards (Impressions/Reached/Engagements/Reactions/Comments/Reposts/Saves/Sends/Link engagements) appear as rendered `"children":["87,780"]` text nodes. The daily chart is serialized as 112 points of the form `{"y":87780,"x":1776384000000,…}` (one per day, where `x` is a UTC-midnight epoch ms and `y` is the metric value).

Key fields (extracted by traversing the RSC tree or regex until LinkedIn publishes a schema):

- Header card: text child of the node near "Impressions"/"Members reached"/"Social engagements" labels
- Reaction breakdown rows: Reactions / Comments / Reposts / Saves / Sends on LinkedIn / Link engagements appear as sibling `<p>`-shaped RSC nodes with numeric children
- Time series: `$.…chart…series[*].data[*]` → `{x,y}` arrays; there are typically 2 overlapping series (Impressions and "prior period")

### 3. Per-post analytics — `/analytics/post-summary/urn:li:activity:<id>/`

Same SDUI architecture as page 2. The recon agent navigated into one post (activity URN `urn:li:activity:7445950871907078144`, 2 weeks old video).

Endpoints fired on load:

- `POST /flagship-web/rsc-action/actions/component?componentId=…postAnalytics…`
- `POST /flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.creatoranalytics.spaSlowMetrics&parentSpanId=…`

Request body is the same shape as above, but carries the activity URN in its state bindings (exact key: `spa_post_analytics_state_post_urn_binding` or similar — not fully paginated).

Response observed (RSC stream, ~86 KB): renders the following cards whose values appear as text children in the tree:

- **Discovery:** 28,360 impressions, 18,767 members reached
- **Profile activity:** 187 profile viewers from this post, 22 followers gained
- **Engagement:** 477 social engagements → 390 reactions (expandable), 32 comments, 2 reposts, 36 saves, 17 sends
- **Top demographics** (all shown in the same response, filterable UI tabs don't refetch):
  - Location — Greater São Paulo Area — 35%
  - Seniority — Senior — 32%
  - Company size — 10,001+ employees — 19%
  - Industry — IT Services and IT Consulting — 16%
  - Job title — Software Engineer — 4%
  - Company — Bemobi — 2%
- **Who's viewed your profile since this post** (Premium section — shows other real LinkedIn members; extension should be careful about exposing this)

Reaction breakdown by type (like/celebrate/support/love/insightful/funny) is **not** inside the analytics RSC response for this post. It comes from the `socialDetail.totalSocialActivityCounts.reactionTypeCounts` field, which is fetched elsewhere (see §4). There's also an expandable "Reactions" chevron (`Reactions 390 >`) — in the old Voyager world that drill-down hit `/voyager/api/voyagerFeedDashReactions?q=reactionType&threadUrn=…`, which likely still exists but was not verified.

Per-post link clicks on the post-summary page were visible at the content-analytics level as "Link engagements" (33 across 90 days); for a per-post value, the recon observed only the aggregate. If the post has a link, LinkedIn shows a separate "Link clicks" card but this specific post was a video so it didn't fire.

### 4. `/my-items/posts/` — this URL 404s

The path `https://www.linkedin.com/my-items/posts/` returns a "This page doesn't exist" screen. LinkedIn has retired it. The working replacement is:

- **URL:** `https://www.linkedin.com/in/<vanity>/recent-activity/all/` (or `.../recent-activity/shares/` for just posts)
- This page is the classic Voyager-backed SPA, and the post list endpoint is:

```
GET /voyager/api/graphql
  ?includeWebMetadata=true
  &variables=(count:20,start:0,profileUrn:urn:li:fsd_profile:<memberUrn>)
  &queryId=voyagerFeedDashProfileUpdates.4af00b28d60ed0f1488018948daad822
```

- **Required headers:** same as §5 — `csrf-token`, `accept: application/json`, `x-restli-protocol-version: 2.0.0`
- **Pagination:** add `,paginationToken:<opaque>` from `data.feedDashProfileUpdatesByMemberShareFeed.metadata.paginationToken`
- **Response shape (truncated):**

```json
{ "data": { "feedDashProfileUpdatesByMemberShareFeed": {
      "metadata": { "paginationToken":"<opaque>", "paginationTokenExpiryTime":… },
      "paging": {…},
      "elements": [ {
        "metadata": { "backendUrn":"urn:li:activity:7451004062705119233",
                      "shareUrn":"urn:li:ugcPost:7450674109228875776", "shareAudience":"PUBLIC", … },
        "actor":    { "subDescription":{"text":"8h • Edited •   "}, … },
        "commentary": { "text": {"text":"𝗤𝘂𝗮𝗻𝘁𝗮𝘀 \"tipos\" de Pix…"} },
        "content":  { "linkedInVideoComponent":{ "videoPlayMetadata":{ "duration":62833,
                       "thumbnail":{…,"rootUrl":"https://media.licdn.com/…"},
                       "progressiveStreams":[…], "adaptiveStreams":[…] } } },
        "socialContent": { "shareUrl":"https://www.linkedin.com/posts/<your-handle>_…" },
        "socialDetail":  { "socialUpdateType":"VIDEO",
                           "threadUrn":"urn:li:ugcPost:7450674109228875776",
                           "totalSocialActivityCounts": {
                              "numImpressions":1096, "numLikes":37, "numComments":1, "numShares":0,
                              "reactionTypeCounts":[
                                {"reactionType":"LIKE","count":34},
                                {"reactionType":"PRAISE","count":3}
                              ] } } },
        { "…": "next element" }
      ] }
  } }
```

Key fields:

- `.elements[i].metadata.backendUrn` → activity URN
- `.elements[i].metadata.shareUrn` → ugcPost URN
- `.elements[i].socialContent.shareUrl` → canonical public post URL
- `.elements[i].commentary.text.text` → post body (stripped of formatting attrs)
- `.elements[i].actor.subDescription.text` → relative age ("8h", "2w", "1mo")
- **For the absolute publication timestamp:** `Number(BigInt(activityId) >> 22n)` gives epoch ms (verified: id `7451004062705119233` → `2026-04-17T20:30:01.510Z`)
- `.elements[i].socialDetail.totalSocialActivityCounts.numImpressions` / `numLikes` / `numComments` / `numShares` → headline counts
- `.elements[i].socialDetail.totalSocialActivityCounts.reactionTypeCounts[*].{reactionType,count}` → breakdown
- `.elements[i].content.linkedInVideoComponent.videoPlayMetadata.progressiveStreams` / `adaptiveStreams` → media URLs
- `.elements[i].content.linkedInVideoComponent.videoPlayMetadata.thumbnail.rootUrl` → poster image
- `.elements[i].content.imageComponent.images[*]` (when image post) → still images
- `.elements[i].content.articleComponent` / `.externalVideoComponent` → attached-link metadata
- `.metadata.paginationToken` → next-page token

### 5. `/in/<your-handle>/` — Profile page

Profile page is also SDUI/RSC rendered with no `<code>` payload in the HTML, but classic Voyager endpoints still power the follower and profile card data and can be called directly. On the prior-gen `/in/…/recent-activity/all/` SPA they fire on every load:

- `GET /voyager/api/graphql?variables=(memberIdentity:<your-handle>)&queryId=voyagerIdentityDashProfiles.9bdce5f8ad48e09bdef1f420fbaae9cc` — top-level profile incl. `followingState.followerCount = <N>`
- `GET /voyager/api/graphql?variables=(profileUrn:urn:li:fsd_profile:<urn>)&queryId=voyagerIdentityDashProfiles.da93c92bffce3da586a992376e42a305` — profile by URN
- `GET /voyager/api/graphql?variables=(profileUrn:urn:li:fsd_profile:<urn>,sectionType:content-collections)&queryId=voyagerIdentityDashProfileComponents.79eb2eecf0510d076d4b7b25b7a3fcde`
- `GET /voyager/api/graphql?variables=(profileUrn:urn:li:fsd_profile:<urn>,sectionType:CONTENT_COLLECTIONS_DETAILS)&queryId=voyagerIdentityDashProfileCards.664e2b2a3534d6b6c474102628a62128`
- `GET /voyager/api/identity/dash/profiles/urn:li:fsd_profile:<urn>` — classic REST view

For connection count the profile GraphQL does not include it. Use:

- `GET /voyager/api/relationships/connectionsSummary` → `{ "entityUrn":"urn:li:fs_relConnectionsSummary:<urn>", "numConnections": 4882 }` (verified)

Also useful on the profile page:

- `GET /voyager/api/me` — current member identity (plainId, miniProfile, premiumSubscriber flag)
- `GET /voyager/api/graphql?queryId=voyagerFeedDashIdentityModule.803fe19f843a4d461478049f70d7babd`

## Field mapping

Given the SDUI rewrite, a lot of the post-analytics values now live in rendered-tree strings. Where a clean numeric field exists the table lists the JSON path; where only the rendered RSC tree carries it, "RSC-text" is noted.

| Metric | Endpoint | JSON path |
|---|---|---|
| Post impressions (per post) | `voyagerFeedDashProfileUpdates` GraphQL | `.data.feedDashProfileUpdatesByMemberShareFeed.elements[i].socialDetail.totalSocialActivityCounts.numImpressions` |
| Post impressions (per post, alt) | `/rsc-action/actions/server-request?sduiid=…spaSlowMetrics` | RSC-text: Discovery card "Impressions" child |
| Reactions (like) | `voyagerFeedDashProfileUpdates` | `.elements[i].socialDetail.totalSocialActivityCounts.reactionTypeCounts[?(@.reactionType=='LIKE')].count` |
| Reactions (celebrate) | same | `reactionTypeCounts[?(@.reactionType=='PRAISE')].count` |
| Reactions (support) | same | `reactionTypeCounts[?(@.reactionType=='EMPATHY')].count` |
| Reactions (love) | same | `reactionTypeCounts[?(@.reactionType=='APPRECIATION')].count` |
| Reactions (insightful) | same | `reactionTypeCounts[?(@.reactionType=='INTEREST')].count` |
| Reactions (funny) | same | `reactionTypeCounts[?(@.reactionType=='ENTERTAINMENT')].count` |
| Reactions (maybe, legacy) | same | `reactionTypeCounts[?(@.reactionType=='MAYBE')].count` |
| Comments | `voyagerFeedDashProfileUpdates` | `.elements[i].socialDetail.totalSocialActivityCounts.numComments` |
| Reposts | `voyagerFeedDashProfileUpdates` | `.elements[i].socialDetail.totalSocialActivityCounts.numShares` |
| Saves (per post) | `/rsc-action/…spaSlowMetrics` | RSC-text: Engagement card "Saves" row value |
| Sends (per post) | `/rsc-action/…spaSlowMetrics` | RSC-text: Engagement card "Sends on LinkedIn" row value |
| Link clicks (per post, if link) | `/rsc-action/…spaSlowMetrics` | RSC-text: "Link clicks" card value (only when present) |
| Viewer job titles / locations / seniority / companies / industries / company sizes | `/rsc-action/…spaSlowMetrics` | RSC-text inside Top demographics sections |
| Post content text | `voyagerFeedDashProfileUpdates` | `.elements[i].commentary.text.text` |
| Post URL | `voyagerFeedDashProfileUpdates` | `.elements[i].socialContent.shareUrl` |
| Post posted-at timestamp | derived | `Number(BigInt(activityId) >> 22n)` from `.elements[i].metadata.backendUrn` |
| Post media URLs (video) | `voyagerFeedDashProfileUpdates` | `.elements[i].content.linkedInVideoComponent.videoPlayMetadata.progressiveStreams[*].streamingLocations[*].url` |
| Post media URLs (image) | `voyagerFeedDashProfileUpdates` | `.elements[i].content.imageComponent.images[*].attributes[*].detailData.vectorImage.rootUrl` + `.artifacts[*].fileIdentifyingUrlPathSegment` |
| Post media URLs (document) | `voyagerFeedDashProfileUpdates` | `.elements[i].content.documentComponent.document.transcribedDocumentUrl` (and `.manifestUrl`) |
| Current follower count | `voyagerIdentityDashProfiles.9bdce5f8ad48e09bdef1f420fbaae9cc` | `.data.identityDashProfilesByMemberIdentity.elements[0].followingState.followerCount` (10228 in session) |
| Connection count | `/voyager/api/relationships/connectionsSummary` | `.numConnections` (4882 in session) |
| Creator dashboard headline impressions (7/14/28/90/365/custom) | `/rsc-action/actions/component?componentId=…contentAnalyticsContent` | RSC-text: Content performance card → "Impressions" child |
| Creator dashboard headline engagements | same | RSC-text: Engagement "Social engagements" |
| Daily time series (any metric) | same RSC component response | Data-array elements of the form `{"x":<utcMidnightMs>,"y":<value>,…}` — 1 per day in the selected range |
| Creator overview (7d impressions, followers, profile viewers, search appearances) | HTML-embedded `<code id="bpr-guid-…">` or replay `voyagerFeedDashCreatorExperienceDashboard.6fcd24af6f10cdcd1cd7d8e747df3276` | `$.…feedDashCreatorExperienceDashboard.section[0].analyticsSection.analyticsPreviews[i].analyticsTitle.text` |
| 12-mo impressions total | `/rsc-action/…component?componentId=…contentAnalyticsContent` with `states: [{startDate: today-365, endDate: today}]` | RSC-text on Content performance card |
| 12-mo engagements total | same, states set to 365d | RSC-text on Engagement card |

## Observed quirks / gotchas

- **`/my-items/posts/` is dead** — don't rely on it. Use `/in/<vanity>/recent-activity/all/` (Voyager-backed) instead.
- **`/analytics/creator/` silently redirects to `/dashboard/`.** The dashboard page has different metrics than the old "12-mo rollup" page — it shows 7d post impressions, current followers, 90d profile viewers, previous-week search appearances. For the 12-mo number you have to go into `/analytics/creator/content/` and set the range to 365 days.
- **SDUI pages do NOT call `/voyager/api/…` from the client.** They POST to `/flagship-web/rsc-action/…`. Any extension that only intercepts `/voyager/…` will miss 100% of the new analytics traffic.
- **RSC responses mix React nodes with data.** The time-series is present as `{x,y}` points but the summary cards are only rendered text nodes with formatted strings like `"87,780"` (note the thousand-separator varies with locale: `lang` cookie set to pt/en changes this). Extract by reading the children text of specific key/componentKey nodes rather than regex-scanning the whole blob.
- **Required RSC headers are unusual.** All RSC POSTs carry `x-li-rsc-stream: 1`, plus the full `x-li-*` tracking suite (`x-li-page-instance`, `x-li-page-instance-tracking-id`, `x-li-application-instance`, `x-li-application-version`, `x-li-anchor-page-key`, `x-li-track`). Miss any of these and the server returns 400.
- **CSRF token lives inside `JSESSIONID`.** Format is `ajax:<17-digit-number>`. A content script can read `document.cookie`; a background script cannot (`JSESSIONID` is not HttpOnly but cookie access from MV3 service workers needs `cookies` permission).
- **`li_at` is HttpOnly** — content scripts won't see it, but `fetch(..., { credentials: 'include' })` will still send it, so direct Voyager replays work without handling the auth cookie manually.
- **`totalSocialActivityCounts.numImpressions` comes from the feed endpoint, not the analytics endpoint.** This is a fast, cheap source of per-post impressions/reactions for every post, without needing to open the analytics page.
- **`socialDetail.totalSocialActivityCounts.reactionTypeCounts` only lists types that have ≥1 count.** Zero-count reactions are omitted; default missing types to 0.
- **Reaction type enum:** `LIKE` (like), `PRAISE` (celebrate), `EMPATHY` (support), `APPRECIATION` (love), `INTEREST` (insightful), `ENTERTAINMENT` (funny), plus the older `MAYBE`/`CURIOUS` which may appear on legacy posts.
- **Video posts do NOT include link clicks;** the "Link engagements" card is suppressed. Treat absence as "N/A" not zero.
- **Pagination via opaque `paginationToken`** — valid only until `paginationTokenExpiryTime`; after that, re-request page 0.
- **Many direct voyager paths from older docs are 404** (`/voyager/api/feed/socialActivityCounts/<urn>`, `/voyager/api/feed/socialDetail/<urn>`). Deprecated. Use the GraphQL `queryId`s above.

## Recommended replay strategy for the extension

Cleanest path is a hybrid: **intercept what's already firing**, and **replay Voyager GraphQL by URN for backfill**.

### Tier 1 — intercept in-place (fastest, most reliable)

- Inject a content script on `*://www.linkedin.com/*` that wraps `window.fetch` and `XMLHttpRequest` at `document_start`.
- Capture URLs matching `/voyager/api/graphql` (classic pages) and `/flagship-web/rsc-action/actions/(component|server-request)` (analytics pages).
- For each capture, clone the response and ship it to the background worker. No need to re-issue the request — the page already paid for it.

### Tier 2 — URN-keyed backfill via Voyager GraphQL (when the user hasn't visited the page recently)

- Post listing: `GET /voyager/api/graphql?includeWebMetadata=true&variables=(count:50,start:0,profileUrn:urn:li:fsd_profile:<memberUrn>)&queryId=voyagerFeedDashProfileUpdates.4af00b28d60ed0f1488018948daad822` — paginate with `paginationToken`. Gives per-post impressions/reactions/comments/re[port truncated here in the original transmission]

> **Note:** The original recon report was cut off at the end of the Tier 2 section. The truncated tail likely covered pagination details and reposts-level endpoint calls; everything architectural is preserved above.
