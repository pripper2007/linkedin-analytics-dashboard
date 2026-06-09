// Aggregates tokenized post content into word-cloud-ready data.
//
// Pipeline:
//   1. Tokenize each post (names + stopwords filtered).
//   2. Stem each token — collapses morphological variants onto a shared
//      stem key (pagamento/pagamentos → pagament).
//   3. Aggregate by STEM: count + post IDs + surface-form examples.
//   4. Mark trending stems (vs. the prior equal-length baseline window).
//   5. (Optional) Ask Claude to cluster the top stems by semantic
//      meaning. Each cluster gets a short label and absorbs its members
//      into one cloud entry (sums counts, unions post IDs).
//   6. For stems that weren't clustered (or when the LLM is
//      unavailable), display the most-frequent surface form as-is.

import { tokenize } from './tokenize';
import { stem } from './stem';
import { clusterWords, type ClusterInput } from './cluster';

const TREND_MULTIPLIER = 2;
const TREND_MIN_ABSOLUTE = 5;
// Display top N words. Reduced from 80 → 50 (2026-05-02) to declutter
// the cloud — the long tail at the bottom of the previous list was hard
// to read and didn't surface insights.
const DEFAULT_TOP_N = 50;
// How many stems to send to Claude for clustering. Keep small enough
// to fit comfortably in one API call and limit cost.
const CLUSTER_TOP_N = 80;

export interface AggregatePost {
  activity_id: string;
  post_content: string;
  posted_at: Date;
}

export interface WordEntry {
  text: string;       // display label (cluster label OR most-frequent surface form)
  count: number;      // combined count across all members
  trending: boolean;  // any member stem is trending
  postIds: string[];  // union of post IDs across all members
  members: string[];  // stems contained (for debugging / future tooltip)
}

export interface AggregateResult {
  words: WordEntry[];
  currentPostCount: number;
  priorPostCount: number;
  /** True iff the LLM clustering ran successfully. */
  clustered: boolean;
}

/** Internal: per-stem accumulator before we decide display label / clustering. */
interface StemEntry {
  count: number;
  postIds: Set<string>;
  // Surface forms observed in this window, count per form. Used to pick
  // the most-frequent surface as the display label when a stem is NOT
  // part of a cluster.
  surfaces: Map<string, number>;
}

/**
 * Split posts into the current window [from, to] and a prior baseline
 * window [from - delta, from), where delta = to - from.
 */
function splitByWindow(
  posts: AggregatePost[],
  from: Date,
  to: Date,
): { current: AggregatePost[]; prior: AggregatePost[] } {
  const delta = to.getTime() - from.getTime();
  const priorFrom = new Date(from.getTime() - delta);
  const current: AggregatePost[] = [];
  const prior: AggregatePost[] = [];
  for (const p of posts) {
    const t = p.posted_at.getTime();
    if (t >= from.getTime() && t <= to.getTime()) current.push(p);
    else if (t >= priorFrom.getTime() && t < from.getTime()) prior.push(p);
  }
  return { current, prior };
}

/** Tokenize → stem → aggregate by stem key, with surface-form tracking. */
function aggregateByStem(posts: AggregatePost[]): Map<string, StemEntry> {
  const map = new Map<string, StemEntry>();
  for (const p of posts) {
    const tokens = tokenize(p.post_content);
    const seenStems = new Set<string>();
    for (const token of tokens) {
      const key = stem(token);
      const entry = map.get(key) ?? {
        count: 0,
        postIds: new Set<string>(),
        surfaces: new Map<string, number>(),
      };
      entry.count += 1;
      entry.surfaces.set(token, (entry.surfaces.get(token) ?? 0) + 1);
      if (!seenStems.has(key)) {
        entry.postIds.add(p.activity_id);
        seenStems.add(key);
      }
      map.set(key, entry);
    }
  }
  return map;
}

/** Most-frequent surface form for a stem, falling back to the stem itself. */
function pickDisplaySurface(surfaces: Map<string, number>, fallback: string): string {
  let best = fallback;
  let bestCount = -1;
  for (const [surface, count] of surfaces) {
    if (count > bestCount) {
      best = surface;
      bestCount = count;
    }
  }
  return best;
}

export async function aggregate(
  posts: AggregatePost[],
  from: Date,
  to: Date,
  topN: number = DEFAULT_TOP_N,
): Promise<AggregateResult> {
  const { current, prior } = splitByWindow(posts, from, to);
  const currentMap = aggregateByStem(current);
  const priorMap = aggregateByStem(prior);

  // Build the candidate list for clustering — top CLUSTER_TOP_N stems
  // by count. Each entry carries up to 3 surface-form examples so
  // Claude has enough context to label the cluster.
  const sortedStems = [...currentMap.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  );
  const clusterInput: ClusterInput[] = sortedStems
    .slice(0, CLUSTER_TOP_N)
    .map(([s, entry]) => {
      const topSurfaces = [...entry.surfaces.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([surface]) => surface);
      return { stem: s, count: entry.count, examples: topSurfaces };
    });

  const clusterResult = await clusterWords(clusterInput);

  // Build output. If we have clusters, merge their member stems into
  // cluster entries. Stems in `excluded` are dropped — both they and
  // any cluster member become "handled" so the standalone fallback
  // loop below doesn't re-add them. Without this, words the LLM
  // explicitly rejected as filler still leaked into the cloud.
  const words: WordEntry[] = [];
  const handled = new Set<string>();
  const excludedSet = new Set(clusterResult?.excluded ?? []);
  for (const stemKey of excludedSet) handled.add(stemKey);

  if (clusterResult) {
    for (const cluster of clusterResult.clusters) {
      let totalCount = 0;
      const postIds = new Set<string>();
      const members: string[] = [];
      let anyTrending = false;
      for (const memberStem of cluster.members) {
        const entry = currentMap.get(memberStem);
        if (!entry) continue;
        handled.add(memberStem);
        members.push(memberStem);
        totalCount += entry.count;
        for (const id of entry.postIds) postIds.add(id);
        const priorCount = priorMap.get(memberStem)?.count ?? 0;
        if (
          entry.count >= Math.max(TREND_MIN_ABSOLUTE, TREND_MULTIPLIER * priorCount)
        ) {
          anyTrending = true;
        }
      }
      if (totalCount === 0) continue;
      words.push({
        text: cluster.label,
        count: totalCount,
        trending: anyTrending,
        postIds: [...postIds],
        members,
      });
    }
  }

  // Any current-window stem that wasn't handled by clustering (either
  // no cluster call, or the LLM excluded it, or it fell below the
  // CLUSTER_TOP_N slice) becomes a standalone entry using its most-
  // frequent surface form as display label.
  for (const [stemKey, entry] of currentMap) {
    if (handled.has(stemKey)) continue;
    const surface = pickDisplaySurface(entry.surfaces, stemKey);
    const priorCount = priorMap.get(stemKey)?.count ?? 0;
    const trending =
      entry.count >= Math.max(TREND_MIN_ABSOLUTE, TREND_MULTIPLIER * priorCount);
    words.push({
      text: surface,
      count: entry.count,
      trending,
      postIds: [...entry.postIds],
      members: [stemKey],
    });
  }

  words.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return {
    words: words.slice(0, topN),
    currentPostCount: current.length,
    priorPostCount: prior.length,
    clustered: clusterResult !== null,
  };
}
