// Shared types for the extension.
//
// These mirror src/app/api/ingest/schema.ts. Keep them in sync when the
// server's Zod schema changes — the extension and the server agree on the
// ingest wire format only by convention, not by shared import.

/**
 * Parsed representation of one post as extracted from a
 * voyagerFeedDashProfileUpdates GraphQL response. This is the intermediate
 * shape before the background worker stamps a snapshotDate and POSTs to
 * /api/ingest.
 */
export interface ParsedPost {
  activityId: string;
  postContent: string;
  postUrl: string;
  /** ISO 8601 timestamp derived from the activity ID's embedded timestamp. */
  postedAt: string;
  impressions: number;
  /** Sum of all reaction types. LinkedIn calls this `numLikes` in the API. */
  reactionsTotal: number;
  reactionsLike?: number;
  reactionsCelebrate?: number;
  reactionsSupport?: number;
  reactionsLove?: number;
  reactionsInsightful?: number;
  reactionsFunny?: number;
  comments: number;
  reposts: number;
  media: ParsedMedia[];
}

export interface ParsedMedia {
  kind: 'image' | 'video' | 'video_thumbnail' | 'document';
  sourceUrl: string;
}

/** One audience-breakdown entry on a single post. Mirrors the server's
 *  demographicEntrySchema. */
export interface PostAnalyticsDemographic {
  category:
    | 'job_title'
    | 'location'
    | 'seniority'
    | 'company'
    | 'industry'
    | 'company_size';
  value: string;
  pct: number;
  rank: number;
}

/**
 * Profile-level capture. Fields are independently optional so a capture
 * from one endpoint (e.g. only connectionsSummary) is valid; the server
 * just writes what it has.
 */
export interface ParsedProfile {
  totalFollowers?: number;
  totalConnections?: number;
}

/**
 * Per-post analytics scraped from LinkedIn's post-summary DOM (Phase
 * 3d.B). Only activityId is required — every metric is independently
 * optional because LinkedIn's UI may not render a field (e.g. a
 * non-video post has no videoViews). The server routes these as
 * snapshot-only ingests since the post-summary page doesn't expose
 * post content / URL / posted-at.
 */
export interface ParsedPostAnalytics {
  activityId: string;
  impressions?: number;
  membersReached?: number;
  reactions?: number;
  comments?: number;
  reposts?: number;
  saves?: number;
  sends?: number;
  profileViewers?: number;
  followersGained?: number;
  linkEngagements?: number;
  videoViews?: number;
  watchTimeSeconds?: number;
  averageWatchTimeSeconds?: number;
  /** Per-post audience breakdown extracted from the analytics page. */
  demographics?: PostAnalyticsDemographic[];
  /**
   * Set by the content script when it detects LinkedIn's "Trouble
   * Loading" / anti-bot response page. The background orchestrator
   * uses this to count consecutive throttled responses and abort
   * the run early if a threshold is exceeded.
   */
  throttled?: true;
  /**
   * Set when the content script's primary-label hydration timeout
   * expires WITHOUT seeing engagement labels OR the throttle text —
   * i.e. LinkedIn served a page neither we recognize as data nor as
   * a known block. Distinct from a true tab-level timeout (no buffer
   * entry at all) — we DO get a marker, paired with a page-fingerprint
   * stored separately for diagnosis.
   */
  noHydration?: true;
}

/**
 * Diagnostic snapshot captured when the content script hits the
 * silent-bail path on a post-summary page (page didn't hydrate, didn't
 * show throttle text). Populated for offline inspection so we can
 * tell apart "old post with no analytics", "auth wall", and other
 * unknown variants without copying anything from DevTools.
 */
export interface PageFingerprint {
  activityId: string;
  capturedAt: string;
  url: string;
  title: string;
  textLen: number;
  /** First ~600 chars of stripped page text. */
  textSample: string;
  /** Which PRIMARY_LABELS were present (usually empty for no-hydration). */
  primaryLabelsFound: string[];
  /** Whether the throttle-page text was matched. */
  isThrottlePage: boolean;
}

// ---------------------------------------------------------------------------
// Messages exchanged between extension contexts (isolated / page / worker).
//
// The page-context interceptor emits discriminated captures; the content
// script relays them to the background worker with the same discriminator.
// ---------------------------------------------------------------------------

type PageCaptureBase = {
  source: 'linkedin-analytics-interceptor';
  pageUrl: string;
  capturedAt: string;
};

export type PageCaptureMessage =
  | (PageCaptureBase & { kind: 'posts'; posts: ParsedPost[] })
  | (PageCaptureBase & { kind: 'profile'; profile: ParsedProfile });

/** Content script → background worker via chrome.runtime.sendMessage. */
export type WorkerMessage =
  | {
      type: 'buffer-posts';
      posts: ParsedPost[];
      pageUrl: string;
      capturedAt: string;
    }
  | {
      type: 'buffer-profile';
      profile: ParsedProfile;
      pageUrl: string;
      capturedAt: string;
    }
  | {
      /**
       * Per-post analytics scraped from /analytics/post-summary/.../.
       * Distinct from buffer-posts so the background can track metrics-
       * only captures separately and merge with feed captures at ingest
       * time.
       */
      type: 'buffer-post-analytics';
      analytics: ParsedPostAnalytics;
      pageUrl: string;
      capturedAt: string;
    }
  | {
      /**
       * Kick off the historical backfill orchestrator (Phase 3d.D).
       * Fetches a list of activity IDs from the server, then iterates
       * through them in hidden tabs with rate-limiting.
       */
      type: 'backfill-now';
    }
  | {
      /**
       * Kick off the legacy-ID resolver. Visits each /feed/update/
       * urn:li:share:X/ or urn:li:ugcPost:X/ URL in the DB, lets the
       * page render, then posts the extracted activity URN back so
       * the server can rewrite the activity_id in place.
       */
      type: 'resolve-ids-now';
    }
  | {
      /**
       * Hard-stop the resolver's alarm chain and mark its status as
       * 'done'. Surfaced as a "Stop resolver" button on the Options
       * page — lets the user kill a runaway without reloading the
       * extension.
       */
      type: 'stop-resolver';
    }
  | {
      /** Same as stop-resolver, for the backfill alarm chain. */
      type: 'stop-backfill';
    }
  | {
      /**
       * Reply from the content script's legacy URL resolver. The
       * background orchestrator forwards this to
       * /api/resolve-activity-id and closes the hidden tab.
       */
      type: 'resolved-activity-id';
      oldActivityId: string;
      newActivityId: string | null;
      pageUrl: string;
    }
  | {
      /**
       * Diagnostic from the /mynetwork/invite-connect/connections DOM
       * scrape. Carries a pre-formatted human-readable string the
       * options page displays verbatim so we can debug scrape failures
       * without asking the user to open DevTools.
       */
      type: 'connections-scrape-debug';
      message: string;
    }
  | {
      /**
       * Sent by the content script when the post-summary page hit the
       * silent-bail path (PRIMARY_TIMEOUT_MS expired with no labels and
       * no throttle text). Stored in a small ring buffer so we can
       * inspect what LinkedIn actually served.
       */
      type: 'buffer-page-fingerprint';
      fingerprint: PageFingerprint;
    }
  | {
      /**
       * Open the analytics page for one activity ID in a FOREGROUND
       * tab so the user can visually inspect what LinkedIn serves.
       * Content script runs as normal — any captured/throttle/no-
       * hydration outcome lands in the existing buffers, so the
       * "Export tick log" / "Export fingerprints" buttons surface
       * the result. Distinct from the orchestrator path (no rate-
       * limiting, no abort accounting).
       */
      type: 'probe-post';
      activityId: string;
    }
  | { type: 'ingest-now' }
  | { type: 'get-status' };

export interface WorkerStatus {
  lastIngestAt: string | null;
  lastIngestResult: 'success' | 'failure' | null;
  lastIngestError: string | null;
  /** Last outcome of the background follower-page fetch. */
  lastFollowerFetch: string | null;
  /**
   * Last time the MAIN-world interceptor caught LinkedIn's own call to
   * connectionsSummary and we parsed a count. Connections capture is
   * opportunistic — LinkedIn doesn't always fire this endpoint on every
   * page, so the value may be stale until the user browses to a page
   * that does (profile, My Network connections list, some feed actions).
   */
  lastConnectionsFetch: string | null;
  /**
   * Diagnostic from the DOM-scrape content script on the connections
   * list page. Populated independently of lastConnectionsFetch so we
   * can see what the content script actually saw, even when the
   * background's orchestrator times out and overwrites its own label.
   */
  lastConnectionsScrapeDebug: string | null;
  bufferedPosts: number;
  /** How many activityIds have post-summary analytics buffered. */
  bufferedPostAnalytics: number;
  bufferedProfile: ParsedProfile | null;
  configured: boolean;
  /** Progress of an in-flight or most-recent backfill run. */
  backfill: BackfillState | null;
  /** Progress of an in-flight or most-recent ID-resolver run. */
  idResolver: IdResolverState | null;
}

export interface IdResolverState {
  status: 'running' | 'done' | 'error';
  total: number;
  completed: number;
  resolved: number;
  failed: number;
  /** Most recent old→new mapping for the status UI. */
  lastMapping: { oldId: string; newId: string | null } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BackfillState {
  /** 'idle' before first run; 'running' mid-run; 'done' / 'error' after. */
  status: 'running' | 'done' | 'error';
  total: number;
  completed: number;
  /** Most recent activityId attempted; useful for debugging. */
  currentActivityId: string | null;
  /** Short error message when status === 'error'. */
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /**
   * Consecutive non-captured outcomes across ticks (any of throttled,
   * timeout, or no-hydration). Replaces the older split counters that
   * had a bug: a 'throttled' outcome reset 'consecutiveTimeouts' to 0
   * and vice versa, so an alternating throttle/timeout pattern (which
   * is exactly what LinkedIn serves under sustained pressure) never
   * tripped the abort. One unified counter, resets only on 'captured'.
   */
  consecutiveNonCaptured: number;
  /**
   * Window ID of the dedicated popup the orchestrator opens at run
   * start. Each capture tab is created with active=true inside this
   * window, which keeps Chrome from throttling its background JS
   * timers — the previous design opened tabs as active=false in the
   * user's main window, and Chrome's background-tab throttling
   * stalled the React analytics-page hydration past our 20s timeout.
   * The window stays focused=false so it doesn't steal focus.
   * Closed by abortBackfill / stop-backfill / done.
   */
  windowId?: number;
  /**
   * Activity IDs the orchestrator has already attempted in this run
   * (any outcome). The server's queue endpoint can keep returning the
   * same top-priority post — e.g. when its just-captured snapshot
   * hasn't yet round-tripped through the DB or doesn't satisfy the
   * "done today" predicate. Without this, the orchestrator looped on
   * a single post 50× until the runaway cap fired. Per-run set,
   * cleared on next startBackfillRun.
   */
  visitedIds: string[];
}

// ---------------------------------------------------------------------------
// Extension settings (stored in chrome.storage.sync).
// ---------------------------------------------------------------------------
export interface ExtensionSettings {
  /** e.g. "http://localhost:3003/api/ingest/" or the deployed Vercel URL. */
  ingestUrl: string;
  /** Matches INGEST_SECRET on the server. */
  ingestSecret: string;
  enabled: boolean;
  /**
   * Optional — the user's own LinkedIn profile URL (e.g.
   * "https://www.linkedin.com/in/pripper/"). When set, the background
   * worker fetches this page on each ingest tick and scrapes the
   * follower count from the server-rendered HTML.
   */
  profileUrl?: string;
}
