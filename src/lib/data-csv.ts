// User-engagement data loaders. Originally these read CSV files at
// `data/linkedin-export/` (committed alongside the LinkedIn complete
// data export). They now read from Postgres tables populated either by
// `scripts/seed-complete-export.ts` (one-time bootstrap) or the
// `/api/import-complete-export` route (web upload).
//
// The exported function shapes are unchanged from the CSV era so
// consumers (currently /activity and /network pages) didn't need to
// change. The module is still server-only — Drizzle imports a Node
// pg client.

import { unstable_cache } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  userComments,
  userReactions,
  userConnections,
} from '@/db/schema';
import type { Post } from './types';

// Same caching strategy as src/lib/queries.ts — see that file's header
// comment for the rationale. The 'analytics' tag is shared so a single
// revalidateTag('analytics') call in /api/ingest invalidates ALL the
// dashboard's cached read paths at once.
const CACHE_TTL_SECONDS = 600;
const ANALYTICS_TAG = 'analytics';

export interface UserComment {
  /** ISO date string "YYYY-MM-DD HH:MM:SS" — kept in this shape to match
   *  the legacy CSV format the activity page already groups by. */
  date: string;
  link: string;
  message: string;
}

export interface UserReaction {
  date: string;
  type: string;
  link: string;
}

export interface MonthlyActivity {
  month: string;
  comments: number;
  reactions: number;
  posts: number;
}

export interface ConnectionEntry {
  firstName: string;
  lastName: string;
  url: string;
  email: string;
  company: string;
  position: string;
  connectedOn: string;
}

/** Format a Date as "YYYY-MM-DD HH:MM:SS" in UTC (matches the legacy
 *  CSV-string format the activity page consumes). */
function formatTs(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export const getUserComments = unstable_cache(
  async (): Promise<UserComment[]> => {
    const rows = await db
      .select({
        commentedAt: userComments.commentedAt,
        link: userComments.link,
        message: userComments.message,
      })
      .from(userComments);
    return rows.map((r) => ({
      date: formatTs(r.commentedAt),
      link: r.link,
      message: r.message,
    }));
  },
  ['getUserComments'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export const getUserReactions = unstable_cache(
  async (): Promise<UserReaction[]> => {
    const rows = await db
      .select({
        reactedAt: userReactions.reactedAt,
        type: userReactions.type,
        link: userReactions.link,
      })
      .from(userReactions);
    return rows.map((r) => ({
      date: formatTs(r.reactedAt),
      type: r.type,
      link: r.link,
    }));
  },
  ['getUserReactions'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export async function getMonthlyActivity(
  posts: Post[] = [],
): Promise<MonthlyActivity[]> {
  const [comments, reactions] = await Promise.all([
    getUserComments(),
    getUserReactions(),
  ]);

  const monthMap = new Map<
    string,
    { comments: number; reactions: number; posts: number }
  >();

  for (const c of comments) {
    const m = c.date.substring(0, 7);
    const entry = monthMap.get(m) ?? { comments: 0, reactions: 0, posts: 0 };
    entry.comments++;
    monthMap.set(m, entry);
  }
  for (const r of reactions) {
    const m = r.date.substring(0, 7);
    const entry = monthMap.get(m) ?? { comments: 0, reactions: 0, posts: 0 };
    entry.reactions++;
    monthMap.set(m, entry);
  }
  for (const p of posts) {
    if (!p.post_date) continue;
    const d = new Date(p.post_date);
    if (Number.isNaN(d.getTime())) continue;
    const m = d.toISOString().substring(0, 7);
    const entry = monthMap.get(m) ?? { comments: 0, reactions: 0, posts: 0 };
    entry.posts++;
    monthMap.set(m, entry);
  }

  return Array.from(monthMap.entries())
    .map(([month, counts]) => ({ month, ...counts }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export const getReactionBreakdown = unstable_cache(
  async (): Promise<{ type: string; count: number }[]> => {
    const rows = (await db.execute(sql`
      SELECT type, COUNT(*)::int AS count
      FROM user_reactions
      GROUP BY type
      ORDER BY count DESC
    `)) as unknown as Array<{ type: string; count: number }>;
    return rows;
  },
  ['getReactionBreakdown'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

export const getConnections = unstable_cache(
  async (): Promise<ConnectionEntry[]> => {
    const rows = await db
      .select({
        firstName: userConnections.firstName,
        lastName: userConnections.lastName,
        profileUrl: userConnections.profileUrl,
        email: userConnections.email,
        company: userConnections.company,
        position: userConnections.position,
        connectedOnRaw: userConnections.connectedOnRaw,
      })
      .from(userConnections);
    return rows.map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      url: r.profileUrl,
      email: r.email ?? '',
      company: r.company ?? '',
      position: r.position ?? '',
      connectedOn: r.connectedOnRaw,
    }));
  },
  ['getConnections'],
  { revalidate: CACHE_TTL_SECONDS, tags: [ANALYTICS_TAG] },
);
