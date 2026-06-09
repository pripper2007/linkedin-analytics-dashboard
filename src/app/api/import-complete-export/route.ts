// POST /api/import-complete-export — accepts the LinkedIn "Get a copy
// of your data" zip and upserts Comments / Reactions / Connections
// CSVs into Postgres.
//
// Request: multipart/form-data with a single "file" field (the zip).
// Auth: dashboard session OR X-Ingest-Secret header.

import { NextResponse } from 'next/server';
import { isAuthorizedRequest } from '../ingest/auth';
import { importCompleteExport } from '@/lib/complete-export-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel default 300s — generous for this; a 50MB zip parses in ~5s.
export const maxDuration = 300;

// 100 MB cap. Real complete exports vary 10-80 MB.
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form_data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file_field' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', maxBytes: MAX_BYTES },
      { status: 413 },
    );
  }

  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  // ZIP magic bytes: PK\x03\x04
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return NextResponse.json({ error: 'not_a_zip_file' }, { status: 400 });
  }

  try {
    const summary = await importCompleteExport(buf);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[import-complete-export]', msg);
    return NextResponse.json(
      { error: 'import_failed', message: msg },
      { status: 500 },
    );
  }
}
