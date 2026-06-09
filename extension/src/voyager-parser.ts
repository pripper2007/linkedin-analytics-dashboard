// Pure parser: voyagerFeedDashProfileUpdates GraphQL response → ParsedPost[].
//
// The response is LinkedIn's Rest.li "normalized" format:
//
//   {
//     data: { data: { feedDashProfileUpdatesByMemberShareFeed: { '*elements': [<urn>, ...] } } },
//     included: [ {...entities...} ],
//     meta: {...}
//   }
//
// Each *element is a URN like `urn:li:fsd_update:(urn:li:activity:N,MEMBER_SHARES,...)`.
// The actual post data lives in `included` keyed by `entityUrn`.
//
// To get metrics we follow:
//   Update (from included[entityUrn matching *element])
//     └─ metadata.shareUrn  → `urn:li:ugcPost:NNNN`
//   SocialActivityCounts (from included[entityUrn = `urn:li:fsd_socialActivityCounts:<shareUrn>`])
//     ├─ numImpressions, numLikes, numComments, numShares
//     └─ reactionTypeCounts[{ reactionType, count }]
//
// The activity ID (for the `posts` table) comes from Update.metadata.backendUrn:
//   `urn:li:activity:NNNN` → NNNN.
//
// LinkedIn's reaction enum:
//   LIKE=like, PRAISE=celebrate, EMPATHY=support, APPRECIATION=love,
//   INTEREST=insightful, ENTERTAINMENT=funny. (MAYBE/CURIOUS legacy values
//   ignored.) Zero-count reactions are omitted from reactionTypeCounts, so
//   when the array is present we seed missing types to 0.

import type { ParsedPost, ParsedMedia } from './types';

type Json = unknown;
type Entity = Record<string, unknown> & { $type?: string; entityUrn?: string };

// -------------------------------------------------------------------------
// deep helpers
// -------------------------------------------------------------------------
function deepGet(obj: Json, path: string | string[]): Json {
  const keys = Array.isArray(path) ? path : [path];
  let cur: Json = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function num(v: Json): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: Json): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// -------------------------------------------------------------------------
// Activity-ID → ISO timestamp.
//
// LinkedIn activity IDs are snowflake-style: upper 42 bits encode the UTC
// epoch-millisecond of the post. Shift right 22 bits to extract.
// -------------------------------------------------------------------------
export function activityIdToIso(activityId: string): string {
  const ms = Number(BigInt(activityId) >> 22n);
  return new Date(ms).toISOString();
}

// -------------------------------------------------------------------------
// Reaction breakdown parser.
// -------------------------------------------------------------------------
interface ReactionFields {
  reactionsLike?: number;
  reactionsCelebrate?: number;
  reactionsSupport?: number;
  reactionsLove?: number;
  reactionsInsightful?: number;
  reactionsFunny?: number;
}

export function parseReactionTypeCounts(raw: Json): ReactionFields {
  if (!Array.isArray(raw)) return {};

  // Present but possibly sparse → seed every slot to 0.
  const out: ReactionFields = {
    reactionsLike: 0,
    reactionsCelebrate: 0,
    reactionsSupport: 0,
    reactionsLove: 0,
    reactionsInsightful: 0,
    reactionsFunny: 0,
  };
  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue;
    const type = (entry as Record<string, unknown>).reactionType;
    const count = (entry as Record<string, unknown>).count;
    if (typeof type !== 'string' || typeof count !== 'number') continue;
    switch (type) {
      case 'LIKE':
        out.reactionsLike = count;
        break;
      case 'PRAISE':
        out.reactionsCelebrate = count;
        break;
      case 'EMPATHY':
        out.reactionsSupport = count;
        break;
      case 'APPRECIATION':
        out.reactionsLove = count;
        break;
      case 'INTEREST':
        out.reactionsInsightful = count;
        break;
      case 'ENTERTAINMENT':
        out.reactionsFunny = count;
        break;
      // Legacy / unknown types: ignore.
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Media extraction (best-effort; missing is fine — media mirroring is a
// later phase). In the normalized format the update has `content` with a
// polymorphic component (video / image / document / article). Some fields
// are direct values, others are URN refs into `included`; we read direct
// values only for now.
// -------------------------------------------------------------------------
export function parseMedia(content: Json): ParsedMedia[] {
  if (content == null || typeof content !== 'object') return [];
  const media: ParsedMedia[] = [];

  // Video — video URLs + thumbnail (when inlined)
  const video = deepGet(content, ['linkedInVideoComponent', 'videoPlayMetadata']);
  if (video && typeof video === 'object') {
    const streams = deepGet(video, 'progressiveStreams');
    if (Array.isArray(streams)) {
      for (const s of streams) {
        const locations = deepGet(s, 'streamingLocations');
        if (!Array.isArray(locations)) continue;
        for (const loc of locations) {
          const url = str(deepGet(loc, 'url'));
          if (url) media.push({ kind: 'video', sourceUrl: url });
        }
      }
    }
    const thumb = str(deepGet(video, ['thumbnail', 'rootUrl']));
    if (thumb) media.push({ kind: 'video_thumbnail', sourceUrl: thumb });
  }

  // Image / carousel — paths are best-effort.
  const imageList = deepGet(content, ['imageComponent', 'images']);
  if (Array.isArray(imageList)) {
    for (const img of imageList) {
      const root = str(
        deepGet(img, ['attributes', '0', 'detailData', 'vectorImage', 'rootUrl']),
      );
      const artifacts = deepGet(img, [
        'attributes',
        '0',
        'detailData',
        'vectorImage',
        'artifacts',
      ]);
      if (root && Array.isArray(artifacts) && artifacts.length > 0) {
        const best = artifacts[artifacts.length - 1];
        const path = str(deepGet(best, 'fileIdentifyingUrlPathSegment'));
        if (path) {
          media.push({ kind: 'image', sourceUrl: root + path });
          continue;
        }
      }
      if (root) media.push({ kind: 'image', sourceUrl: root });
    }
  }

  // Document (PDF, slides)
  const docUrl = str(
    deepGet(content, ['documentComponent', 'document', 'transcribedDocumentUrl']),
  );
  if (docUrl) media.push({ kind: 'document', sourceUrl: docUrl });

  return media;
}

// -------------------------------------------------------------------------
// Build a URN → entity lookup from the `included` array. Only keeps
// entries with a string entityUrn.
// -------------------------------------------------------------------------
function buildIncludedMap(included: unknown): Map<string, Entity> {
  const map = new Map<string, Entity>();
  if (!Array.isArray(included)) return map;
  for (const entry of included) {
    if (entry == null || typeof entry !== 'object') continue;
    const urn = (entry as Entity).entityUrn;
    if (typeof urn === 'string') map.set(urn, entry as Entity);
  }
  return map;
}

// -------------------------------------------------------------------------
// Parse one Update entity into a ParsedPost.
// -------------------------------------------------------------------------
function parseUpdate(
  update: Entity,
  byUrn: Map<string, Entity>,
): ParsedPost | null {
  // activity URN / activity ID
  const backendUrn = str(deepGet(update, ['metadata', 'backendUrn']));
  if (!backendUrn) return null;
  const m = /^urn:li:activity:(\d+)$/.exec(backendUrn);
  if (!m) return null;
  const activityId = m[1];

  // Post content + URL
  const postContent = str(deepGet(update, ['commentary', 'text', 'text'])) ?? '';
  const postUrl =
    str(deepGet(update, ['socialContent', 'shareUrl'])) ??
    `https://www.linkedin.com/feed/update/${backendUrn}/`;

  // Find the associated SocialActivityCounts. LinkedIn keys those by
  //   `urn:li:fsd_socialActivityCounts:<shareUrn>`
  // where shareUrn is a ugcPost/activity URN. Prefer shareUrn; fall back
  // to backendUrn (activity URN) if shareUrn is missing.
  const shareUrn = str(deepGet(update, ['metadata', 'shareUrn'])) ?? backendUrn;
  const countsUrn = `urn:li:fsd_socialActivityCounts:${shareUrn}`;
  const counts = byUrn.get(countsUrn);

  const impressions = num(deepGet(counts, 'numImpressions'));
  const reactionsTotal = num(deepGet(counts, 'numLikes'));
  const comments = num(deepGet(counts, 'numComments'));
  const reposts = num(deepGet(counts, 'numShares'));
  const reactions = parseReactionTypeCounts(deepGet(counts, 'reactionTypeCounts'));

  return {
    activityId,
    postContent,
    postUrl,
    postedAt: activityIdToIso(activityId),
    impressions,
    reactionsTotal,
    ...reactions,
    comments,
    reposts,
    media: parseMedia(deepGet(update, 'content')),
  };
}

// -------------------------------------------------------------------------
// Public: parse a full response.
// -------------------------------------------------------------------------
export function parseFeedDashProfileUpdates(json: Json): ParsedPost[] {
  // *elements lives inside a double-wrapped `data` object.
  const elements = deepGet(json, [
    'data',
    'data',
    'feedDashProfileUpdatesByMemberShareFeed',
    '*elements',
  ]);
  if (!Array.isArray(elements)) return [];

  const byUrn = buildIncludedMap(deepGet(json, 'included'));

  const out: ParsedPost[] = [];
  for (const urn of elements) {
    if (typeof urn !== 'string') continue;
    const entity = byUrn.get(urn);
    if (!entity) continue;
    if (entity.$type !== 'com.linkedin.voyager.dash.feed.Update') continue;
    const post = parseUpdate(entity, byUrn);
    if (post) out.push(post);
  }
  return out;
}

// -------------------------------------------------------------------------
// URL matcher — unchanged from the previous version.
// -------------------------------------------------------------------------
const FEED_DASH_PROFILE_UPDATES_QUERY_ID =
  /voyagerFeedDashProfileUpdates\.[0-9a-f]{16,}/;

export function isFeedDashProfileUpdatesUrl(url: string): boolean {
  if (!url.includes('/voyager/api/graphql')) return false;
  return FEED_DASH_PROFILE_UPDATES_QUERY_ID.test(url);
}
