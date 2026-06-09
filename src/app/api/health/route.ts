// GET /api/health — unauthenticated status endpoint for uptime monitors
// and the dashboard's own "last captured" indicator.
//
// Always returns HTTP 200 with a JSON body; the caller inspects the
// shape. That makes the endpoint trivially usable by Uptime Robot / Pingdom
// (which only care about 2xx) without teaching them our failure modes.
//
// Shape:
//   {
//     ok: boolean,                       // overall: DB up AND a success in last 48h
//     generatedAt: string,               // ISO timestamp
//     db: { reachable: boolean, latencyMs: number },
//     lastIngest: {
//       at: string | null,               // most recent attempt (any status)
//       status: string | null,           // 'success' | 'failure' | ...
//       source: string | null,           // e.g. 'extension-v1'
//       hoursAgo: number | null,
//     },
//     lastSuccess: {
//       at: string | null,
//       hoursAgo: number | null,
//     },
//     postsLast7d: number,                 // sum of postsCaptured over last 7d successes
//   }

import { NextResponse } from 'next/server';
import { sql, desc, eq, and, gte } from 'drizzle-orm';

import { db } from '@/db/client';
import { ingestLog } from '@/db/schema';

export const runtime = 'nodejs';
// Short ISR window so repeated polls don't hammer Supabase.
export const revalidate = 60;

export async function GET(): Promise<NextResponse> {
  const generatedAt = new Date();
  const now = generatedAt.getTime();

  // --- DB ping: one cheap round-trip so reachable+latency are honest. ---
  let dbReachable = false;
  let dbLatencyMs = 0;
  const pingStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    dbReachable = true;
  } catch (err) {
    console.error('[health] DB ping failed:', err);
  }
  dbLatencyMs = Date.now() - pingStart;

  // --- Last attempt (any status) ---
  let lastAt: Date | null = null;
  let lastStatus: string | null = null;
  let lastSource: string | null = null;
  if (dbReachable) {
    try {
      const [row] = await db
        .select({
          startedAt: ingestLog.startedAt,
          status: ingestLog.status,
          source: ingestLog.source,
        })
        .from(ingestLog)
        .orderBy(desc(ingestLog.startedAt))
        .limit(1);
      if (row) {
        lastAt = row.startedAt;
        lastStatus = row.status;
        lastSource = row.source;
      }
    } catch (err) {
      console.error('[health] lastIngest query failed:', err);
    }
  }

  // --- Last successful attempt ---
  let lastSuccessAt: Date | null = null;
  if (dbReachable) {
    try {
      const [row] = await db
        .select({ startedAt: ingestLog.startedAt })
        .from(ingestLog)
        .where(eq(ingestLog.status, 'success'))
        .orderBy(desc(ingestLog.startedAt))
        .limit(1);
      lastSuccessAt = row?.startedAt ?? null;
    } catch (err) {
      console.error('[health] lastSuccess query failed:', err);
    }
  }

  // --- Posts captured in the last 7 days (successful runs only) ---
  let postsLast7d = 0;
  if (dbReachable) {
    try {
      const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const [row] = await db
        .select({
          total: sql<number>`COALESCE(SUM(${ingestLog.postsCaptured}), 0)::int`,
        })
        .from(ingestLog)
        .where(
          and(eq(ingestLog.status, 'success'), gte(ingestLog.startedAt, cutoff)),
        );
      postsLast7d = Number(row?.total ?? 0);
    } catch (err) {
      console.error('[health] postsLast7d query failed:', err);
    }
  }

  const hoursSince = (d: Date | null): number | null =>
    d ? Math.round(((now - d.getTime()) / 3_600_000) * 10) / 10 : null;

  const ok =
    dbReachable &&
    lastSuccessAt != null &&
    now - lastSuccessAt.getTime() < 48 * 60 * 60 * 1000;

  return NextResponse.json({
    ok,
    generatedAt: generatedAt.toISOString(),
    db: { reachable: dbReachable, latencyMs: dbLatencyMs },
    lastIngest: {
      at: lastAt?.toISOString() ?? null,
      status: lastStatus,
      source: lastSource,
      hoursAgo: hoursSince(lastAt),
    },
    lastSuccess: {
      at: lastSuccessAt?.toISOString() ?? null,
      hoursAgo: hoursSince(lastSuccessAt),
    },
    postsLast7d,
  });
}
