// Importer for LinkedIn's "Get a copy of your data" zip — the
// "Complete data export" requested via Settings → Data Privacy. We
// extract three CSVs (Comments, Reactions, Connections) and upsert
// them into Postgres. Shared between the API route
// /api/import-complete-export and a one-shot migration script that
// loads the existing data/linkedin-export/ files into the new tables
// before the cutover.

import JSZip from 'jszip';
import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { userComments, userReactions, userConnections } from '@/db/schema';

// ---------------------------------------------------------------------------
// CSV parser — RFC 4180-ish. Same logic the Shares.csv parser uses;
// duplicated here so this lib has no coupling to the migration script.
// ---------------------------------------------------------------------------
export function parseRfc4180(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (c === '\r' && i + 1 < n && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "2026-04-11 22:05:54" → Date. LinkedIn export timestamps are
 *  server-side UTC. */
function parseExportTimestamp(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se),
    ),
  );
}

/** Parse "17 Dec 2003" → "2003-12-17". Returns null if unparseable. */
function parseConnectedOn(raw: string): string | null {
  const m = /^(\d{1,2}) (\w{3}) (\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, monStr, yyyy] = m;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const idx = months.indexOf(monStr);
  if (idx < 0) return null;
  return `${yyyy}-${String(idx + 1).padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Comments.csv → user_comments
//
// Header: Date,Link,Message
// ---------------------------------------------------------------------------
export async function importComments(text: string): Promise<number> {
  const rows = parseRfc4180(text);
  if (rows.length < 2) return 0;
  const header = rows[0].map((h) => h.trim());
  const dateCol = header.indexOf('Date');
  const linkCol = header.indexOf('Link');
  const messageCol = header.indexOf('Message');
  if (dateCol < 0 || linkCol < 0 || messageCol < 0) {
    throw new Error(`Comments.csv missing expected columns: ${header.join(',')}`);
  }
  // Bulk-insert in batches with onConflictDoNothing on the (date, link) unique.
  const batch: { commentedAt: Date; link: string; message: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ts = parseExportTimestamp(r[dateCol] ?? '');
    if (!ts) continue;
    const link = decodeURIComponent((r[linkCol] ?? '').trim());
    const message = (r[messageCol] ?? '').trim();
    if (!link) continue;
    batch.push({ commentedAt: ts, link, message });
  }
  if (batch.length === 0) return 0;
  // Insert in chunks to avoid hitting Postgres parameter limits.
  let inserted = 0;
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await db.insert(userComments).values(chunk).onConflictDoNothing();
    inserted += chunk.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Reactions.csv → user_reactions
//
// Header: Date,Type,Link
// ---------------------------------------------------------------------------
export async function importReactions(text: string): Promise<number> {
  const rows = parseRfc4180(text);
  if (rows.length < 2) return 0;
  const header = rows[0].map((h) => h.trim());
  const dateCol = header.indexOf('Date');
  const typeCol = header.indexOf('Type');
  const linkCol = header.indexOf('Link');
  if (dateCol < 0 || typeCol < 0 || linkCol < 0) {
    throw new Error(`Reactions.csv missing expected columns: ${header.join(',')}`);
  }
  const batch: { reactedAt: Date; type: string; link: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ts = parseExportTimestamp(r[dateCol] ?? '');
    if (!ts) continue;
    const type = (r[typeCol] ?? '').trim();
    const link = decodeURIComponent((r[linkCol] ?? '').trim());
    if (!type || !link) continue;
    batch.push({ reactedAt: ts, type, link });
  }
  if (batch.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await db.insert(userReactions).values(chunk).onConflictDoNothing();
    inserted += chunk.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Connections.csv → user_connections
//
// LinkedIn's Connections.csv has a few "Notes:" lines at the top before
// the actual header. We scan for the line beginning "First Name,".
//
// Header: First Name,Last Name,URL,Email Address,Company,Position,Connected On
// ---------------------------------------------------------------------------
export async function importConnections(text: string): Promise<number> {
  const rows = parseRfc4180(text);
  // Find the actual header row.
  const headerIdx = rows.findIndex(
    (r) => r[0]?.trim() === 'First Name' && r[1]?.trim() === 'Last Name',
  );
  if (headerIdx < 0 || rows.length <= headerIdx + 1) return 0;
  const header = rows[headerIdx].map((h) => h.trim());
  const cols = {
    firstName: header.indexOf('First Name'),
    lastName: header.indexOf('Last Name'),
    url: header.indexOf('URL'),
    email: header.indexOf('Email Address'),
    company: header.indexOf('Company'),
    position: header.indexOf('Position'),
    connectedOn: header.indexOf('Connected On'),
  };

  const batch: Array<{
    firstName: string;
    lastName: string;
    profileUrl: string;
    email: string | null;
    company: string | null;
    position: string | null;
    connectedOnRaw: string;
    connectedAt: string | null;
  }> = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const profileUrl = (r[cols.url] ?? '').trim();
    if (!profileUrl) continue;
    const connectedOnRaw = (r[cols.connectedOn] ?? '').trim();
    batch.push({
      firstName: (r[cols.firstName] ?? '').trim(),
      lastName: (r[cols.lastName] ?? '').trim(),
      profileUrl,
      email: (r[cols.email] ?? '').trim() || null,
      company: (r[cols.company] ?? '').trim() || null,
      position: (r[cols.position] ?? '').trim() || null,
      connectedOnRaw,
      connectedAt: parseConnectedOn(connectedOnRaw),
    });
  }
  if (batch.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    // Upsert: on conflict (profile_url) update mutable fields.
    await db
      .insert(userConnections)
      .values(chunk)
      .onConflictDoUpdate({
        target: userConnections.profileUrl,
        set: {
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          email: sql`excluded.email`,
          company: sql`excluded.company`,
          position: sql`excluded.position`,
          connectedOnRaw: sql`excluded.connected_on_raw`,
          connectedAt: sql`excluded.connected_at`,
        },
      });
    inserted += chunk.length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Top-level: take a zip buffer, find each CSV, run its importer.
// ---------------------------------------------------------------------------
export interface CompleteExportSummary {
  comments: number;
  reactions: number;
  connections: number;
  filesFound: string[];
}

export async function importCompleteExport(
  buffer: ArrayBuffer | Buffer,
): Promise<CompleteExportSummary> {
  const zip = await JSZip.loadAsync(buffer);
  const filesFound: string[] = [];
  let comments = 0;
  let reactions = 0;
  let connections = 0;

  // Files sit at the root of the zip. Walk every top-level file and match by name.
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name];
    if (file.dir) continue;
    const baseName = name.split('/').pop()?.toLowerCase() ?? '';
    if (baseName === 'comments.csv') {
      filesFound.push(name);
      const text = await file.async('string');
      comments = await importComments(text);
    } else if (baseName === 'reactions.csv') {
      filesFound.push(name);
      const text = await file.async('string');
      reactions = await importReactions(text);
    } else if (baseName === 'connections.csv') {
      filesFound.push(name);
      const text = await file.async('string');
      connections = await importConnections(text);
    }
  }
  return { comments, reactions, connections, filesFound };
}
