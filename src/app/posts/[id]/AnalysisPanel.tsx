'use client';

// Phase 9.A — Claude post analysis panel.
//
// Lifecycle:
//   - On mount: if `cachedAnalysis` is non-null, render it as the
//     starting state. Otherwise show a "Run analysis" CTA.
//   - "Re-analyze" / "Run analysis" button POSTs to /api/analyze-post/[id]
//     and reads the response body as a stream of text deltas, appending
//     to a state buffer rendered as live markdown.
//   - On stream completion the post-summary timestamp updates to "just now".
//   - If the current skill-file hash differs from the cached row's hash,
//     the panel shows a "Skill updated since last analysis" badge.

import { useRef, useState } from 'react';

interface CachedAnalysis {
  analyzedAt: string;
  model: string;
  skillHash: string;
  whatWorked: string;
  whatCouldImprove: string;
  rewriteSuggestions: string;
  lessonToRemember: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface Props {
  activityId: string;
  cachedAnalysis: CachedAnalysis | null;
  /** SHA-256 of the on-disk skill file at server-render time. Compared
   *  against cachedAnalysis.skillHash to surface the "skill updated" badge. */
  currentSkillHash: string;
}

const SECTION_HEADERS = [
  'O que funcionou',
  'O que pode melhorar',
  'Sugestões de reescrita',
  'Lição para guardar',
];

export function AnalysisPanel({
  activityId,
  cachedAnalysis,
  currentSkillHash,
}: Props) {
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Compose the markdown shown in the panel:
  //   - while streaming → use the live streamedText
  //   - otherwise → reconstruct the four sections from the cached row
  const liveMarkdown = streamedText
    ? streamedText
    : cachedAnalysis
      ? cachedToMarkdown(cachedAnalysis)
      : null;

  const skillStale =
    cachedAnalysis !== null &&
    cachedAnalysis.skillHash !== currentSkillHash;

  async function runAnalysis(force: boolean) {
    setError(null);
    setStreamedText('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const url = force
        ? `/api/analyze-post/${activityId}?force=1`
        : `/api/analyze-post/${activityId}`;
      const resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(
          `Falhou (${resp.status}): ${data.error ?? 'erro desconhecido'}`,
        );
        return;
      }
      // If the response is JSON it means cache HIT — no streaming, just
      // render and return.
      const contentType = resp.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (data.analysis) {
          setStreamedText(cachedToMarkdown(data.analysis));
        }
        return;
      }
      // Otherwise stream the text body.
      const reader = resp.body?.getReader();
      if (!reader) {
        setError('Sem corpo de resposta.');
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setStreamedText((prev) => prev + chunk);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div
      className="rounded-lg border p-5 mb-6"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Análise do Claude
          </h2>
          <p
            className="text-xs mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Crítica qualitativa contra a sua skill de escrita (
            <code>skills/example-linkedin-writer.md</code>).
            {cachedAnalysis && !streaming && (
              <>
                {' '}Última análise:{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  {formatRelative(cachedAnalysis.analyzedAt)}
                </span>
                .
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {skillStale && !streaming && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: '#b45309',
              }}
              title="A skill mudou desde a última análise — re-analisar para refletir as regras atuais."
            >
              skill atualizada
            </span>
          )}
          <button
            onClick={() => runAnalysis(cachedAnalysis !== null)}
            disabled={streaming}
            className="px-3 py-1.5 rounded text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {streaming
              ? 'Analisando…'
              : cachedAnalysis
                ? 'Re-analisar'
                : 'Analisar este post'}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="p-3 rounded border text-sm mb-3"
          style={{
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            color: '#b91c1c',
          }}
        >
          {error}
        </div>
      )}

      {liveMarkdown ? (
        <MarkdownRender text={liveMarkdown} />
      ) : (
        <p
          className="text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          Nenhuma análise ainda. Clique em &ldquo;Analisar este post&rdquo;
          para gerar uma crítica de ~30 segundos contra a sua rubric de
          escrita.
        </p>
      )}

      {cachedAnalysis &&
        !streaming &&
        cachedAnalysis.inputTokens !== null && (
          <p
            className="text-xs mt-3"
            style={{ color: 'var(--text-muted)' }}
          >
            {cachedAnalysis.model} ·{' '}
            {(cachedAnalysis.inputTokens ?? 0).toLocaleString()} in /{' '}
            {(cachedAnalysis.outputTokens ?? 0).toLocaleString()} out tokens
          </p>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cachedToMarkdown(c: {
  whatWorked: string;
  whatCouldImprove: string;
  rewriteSuggestions: string;
  lessonToRemember: string;
}): string {
  return [
    `## ${SECTION_HEADERS[0]}\n\n${c.whatWorked}`,
    `## ${SECTION_HEADERS[1]}\n\n${c.whatCouldImprove}`,
    `## ${SECTION_HEADERS[2]}\n\n${c.rewriteSuggestions}`,
    `## ${SECTION_HEADERS[3]}\n\n${c.lessonToRemember}`,
  ].join('\n\n');
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s atrás`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

// Minimal markdown renderer — handles only what Claude actually emits
// for this prompt: `## H2` headers + plain paragraphs separated by
// blank lines. Avoids pulling in react-markdown (~100KB) for ~30 lines
// of needs.
function MarkdownRender({ text }: { text: string }) {
  const blocks: Array<{ type: 'h2' | 'p'; content: string }> = [];
  const lines = text.split(/\n/);
  let buffer: string[] = [];
  function flushParagraph() {
    if (buffer.length === 0) return;
    const content = buffer.join(' ').trim();
    if (content) blocks.push({ type: 'p', content });
    buffer = [];
  }
  for (const raw of lines) {
    const line = raw.trim();
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      flushParagraph();
      blocks.push({ type: 'h2', content: h2[1].trim() });
      continue;
    }
    if (line === '') {
      flushParagraph();
    } else {
      buffer.push(line);
    }
  }
  flushParagraph();

  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.type === 'h2' ? (
          <h3
            key={i}
            className="text-sm font-semibold uppercase tracking-wider mt-4"
            style={{ color: 'var(--text-primary)' }}
          >
            {b.content}
          </h3>
        ) : (
          <p
            key={i}
            className="text-sm leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {b.content}
          </p>
        ),
      )}
    </div>
  );
}
