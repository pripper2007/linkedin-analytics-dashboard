// POST /api/import-aggregate-xlsx — accepts an AggregateAnalytics xlsx
// upload and runs the same ENGAGEMENT / FOLLOWERS / DEMOGRAPHICS import
// path as scripts/backfill-historical.ts. Powers the /data-health page's
// "Refresh" flow so the user doesn't need a terminal.
//
// Request: multipart/form-data with a single "file" field (the xlsx).
// Auth: same X-Ingest-Secret header as /api/ingest.
//
// Response shape:
//   { ok: true, summary: { engagementRows, followerRows, demographicRows,
//                          followerAnchorDate, followerAnchorTotal } }

import { NextResponse } from 'next/server';
import { isAuthorizedRequest } from '../ingest/auth';
import { importAggregateXlsx } from '@/lib/aggregate-xlsx-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 5 MB cap. Real xlsx exports we've seen are 12-25 KB; this leaves ample
// margin while preventing accidental wrong-file uploads.
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'invalid_form_data' },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'missing_file_field' },
      { status: 400 },
    );
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

  // The xlsx library reads from a Buffer. We do a sanity check on the
  // filename + first-bytes magic to fail fast on non-xlsx uploads.
  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  // .xlsx is a ZIP container — first bytes "PK\x03\x04".
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return NextResponse.json(
      { error: 'not_an_xlsx_file' },
      { status: 400 },
    );
  }

  try {
    const summary = await importAggregateXlsx(buf);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[import-aggregate-xlsx]', msg);
    return NextResponse.json(
      { error: 'import_failed', message: msg },
      { status: 500 },
    );
  }
}
