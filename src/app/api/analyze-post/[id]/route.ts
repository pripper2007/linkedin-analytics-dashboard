// POST /api/analyze-post/[id] — Claude-driven qualitative critique of a
// single post. Streams markdown text deltas to the client; persists the
// parsed result to post_analyses on completion.
//
// Auth: dashboard session OR X-Ingest-Secret header (same pattern as
// /api/import-aggregate-xlsx).
//
// Caching: if a row already exists for this activityId with the same
// skill_hash AND the request didn't include `?force=1`, return the
// cached row as JSON (no LLM call). The client component prefers
// `cachedAnalysis` from the server-rendered prop and only POSTs when
// the user clicks the explicit Analyze / Re-analyze button.

import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { postAnalyses, posts } from '@/db/schema';
import { isAuthorizedRequest } from '../../ingest/auth';
import { getAnthropic } from '@/lib/ai/anthropic';
import { getAllPosts, getPostById } from '@/lib/queries';
import { buildAnalysisContext } from '@/lib/analyze-post/build-context';
import { composeAnalysisUserMessage } from '@/lib/analyze-post/prompt';
import { parseAnalysisMarkdown } from '@/lib/analyze-post/schema';
import { loadSkillFile } from '@/lib/analyze-post/skill-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Generous: streaming + thinking + ~5K output tokens fits well under
// 5 minutes; setting 300s leaves a margin if the model takes its time.
export const maxDuration = 300;

const MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// GET — return the cached analysis (latest row) for the activityId, or
// 404 if none exists. Used by client components that want to refetch
// after a streaming completion to pick up token counts + ID.
// ---------------------------------------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const row = await latestAnalysis(params.id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, analysis: row });
}

// ---------------------------------------------------------------------------
// POST — stream a fresh analysis. Streams plain text (markdown) and
// persists on completion. Pass ?force=1 to bypass the same-skill-hash
// cache check.
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    return await handlePost(request, params.id);
  } catch (err) {
    // Surface the actual error message in the response so the client
    // can show something useful, and log to Vercel Functions logs for
    // post-mortem. Without this, an uncaught throw would render
    // Next.js's HTML 500 page and make remote debugging painful.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[analyze-post] unhandled error:', msg, stack);
    return NextResponse.json(
      { error: 'analyze_failed', message: msg },
      { status: 500 },
    );
  }
}

async function handlePost(
  request: Request,
  activityId: string,
): Promise<Response> {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get('force') === '1';

  // Confirm the post exists (cheap; getPostById is cached).
  const post = await getPostById(activityId);
  if (!post) {
    return NextResponse.json({ error: 'post_not_found' }, { status: 404 });
  }

  const skill = await loadSkillFile();

  // Cache check.
  if (!force) {
    const cached = await latestAnalysis(activityId);
    if (cached && cached.skillHash === skill.hash) {
      return NextResponse.json(
        { ok: true, cached: true, analysis: cached },
        { headers: { 'x-cache': 'HIT' } },
      );
    }
  }

  const client = getAnthropic();
  if (!client) {
    return NextResponse.json(
      { error: 'ai_unavailable', message: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    );
  }

  // Build the prompt context. Pull the full pool so the cohort + pool
  // baseline reflect everything captured.
  const allPosts = await getAllPosts();
  const ctx = buildAnalysisContext(post, allPosts);
  const userMessage = composeAnalysisUserMessage(ctx);

  // Stream raw text deltas to the client. We accumulate the full text
  // server-side and persist on completion.
  const encoder = new TextEncoder();
  let accumulated = '';

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          system: [
            {
              type: 'text',
              text: skill.content,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userMessage }],
        });

        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const text = event.delta.text;
            accumulated += text;
            controller.enqueue(encoder.encode(text));
          }
        }

        const final = await stream.finalMessage();
        // Parse + persist. If parsing fails (model deviated), surface
        // the error in the stream tail and skip persistence — the
        // client just sees what was streamed and shows a recoverable
        // message.
        try {
          const parsed = parseAnalysisMarkdown(accumulated);
          await db.insert(postAnalyses).values({
            activityId,
            model: MODEL,
            skillHash: skill.hash,
            whatWorked: parsed.whatWorked,
            whatCouldImprove: parsed.whatCouldImprove,
            rewriteSuggestions: parsed.rewriteSuggestions,
            lessonToRemember: parsed.lessonToRemember,
            inputTokens: final.usage?.input_tokens ?? null,
            outputTokens: final.usage?.output_tokens ?? null,
            // Anthropic returns thinking tokens as part of cache_creation_input_tokens / etc;
            // pull what's available — null is fine if the SDK doesn't expose it.
            thinkingTokens:
              (final.usage as { thinking_tokens?: number } | undefined)
                ?.thinking_tokens ?? null,
          });
          // Invalidate this specific post page so the next navigation
          // re-renders with the fresh cached row. We avoid the broader
          // 'analytics' tag bust here — it would drop every dashboard
          // cache, expensive for a relatively rare action.
          revalidatePath(`/posts/${activityId}`);
        } catch (err) {
          console.error(
            '[analyze-post] parse/persist failed for',
            activityId,
            err,
          );
        }
        controller.close();
      } catch (err) {
        console.error('[analyze-post] stream error for', activityId, err);
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function latestAnalysis(activityId: string) {
  const rows = await db
    .select()
    .from(postAnalyses)
    .where(eq(postAnalyses.activityId, activityId))
    .orderBy(desc(postAnalyses.analyzedAt))
    .limit(1);
  return rows[0] ?? null;
}

// Mark `posts` import as used (drizzle's tree-shaker won't strip it
// because the table is referenced via FK in postAnalyses; an unused
// direct import would still trip eslint though).
void posts;
