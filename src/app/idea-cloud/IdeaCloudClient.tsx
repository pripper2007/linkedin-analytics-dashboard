'use client';

// Client shell for /word-cloud. Responsibilities:
//   - Period chip buttons + custom date picker. Period state lives in URL
//     search params so the back button and direct-link sharing Just Work.
//   - Owns the "selected word" state (ephemeral, not in URL).
//   - Renders the cloud + a side panel listing posts containing the
//     selected word.

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import WordCloudChart, {
  type WordCloudWord,
} from '@/components/charts/WordCloudChart';

export interface PostSummary {
  activity_id: string;
  post_content: string;
  post_date: string;
  post_url: string;
  impressions: number;
  reactions: number;
  comments: number;
}

interface WordEntry extends WordCloudWord {
  postIds: string[];
}

interface Props {
  period: string;
  from: string;
  to: string;
  words: WordEntry[];
  postIndex: Record<string, PostSummary>;
  currentPostCount: number;
  priorPostCount: number;
  /** True when the LLM clustering pass ran successfully. */
  clustered: boolean;
}

const PRESETS: { id: string; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '365d', label: 'Last 365 days' },
];

export default function WordCloudClient(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  // Build a new URL preserving unrelated params but swapping period/from/to.
  const buildHref = (period: string, from?: string, to?: string): string => {
    const params = new URLSearchParams(search.toString());
    params.set('period', period);
    if (period === 'custom' && from && to) {
      params.set('from', from);
      params.set('to', to);
    } else {
      params.delete('from');
      params.delete('to');
    }
    return `${pathname}?${params.toString()}`;
  };

  const selected = useMemo(
    () => props.words.find((w) => w.text === selectedWord) ?? null,
    [props.words, selectedWord],
  );
  const selectedPosts: PostSummary[] = useMemo(() => {
    if (!selected) return [];
    return selected.postIds
      .map((id) => props.postIndex[id])
      .filter((p): p is PostSummary => !!p);
  }, [selected, props.postIndex]);

  const trendingCount = props.words.filter((w) => w.trending).length;

  return (
    <div className="space-y-6">
      <header>
        <h1
          className="text-2xl font-bold"
          style={{ color: 'var(--text-primary)' }}
        >
          Idea Cloud
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Semantic map of ideas across your LinkedIn posts.{' '}
          {props.currentPostCount} post{props.currentPostCount === 1 ? '' : 's'}{' '}
          in the current window, {props.priorPostCount} in the prior comparable
          window.
          {trendingCount > 0 && (
            <>
              {' '}
              <span style={{ color: 'var(--accent)' }}>
                {trendingCount} trending
              </span>{' '}
              (≥2× vs. prior period, min 5 mentions).
            </>
          )}
          {!props.clustered && (
            <>
              {' '}
              <span style={{ color: 'var(--text-muted)' }}>
                (AI clustering unavailable — showing stems only. Set{' '}
                <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> to
                enable semantic grouping.)
              </span>
            </>
          )}
        </p>
      </header>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const active = props.period === p.id;
          return (
            <button
              key={p.id}
              onClick={() => router.push(buildHref(p.id))}
              className="px-3 py-1.5 rounded-full text-sm font-medium transition border"
              style={{
                backgroundColor: active
                  ? 'var(--accent)'
                  : 'var(--bg-card)',
                color: active ? '#ffffff' : 'var(--text-primary)',
                borderColor: active ? 'var(--accent)' : 'var(--border)',
              }}
            >
              {p.label}
            </button>
          );
        })}
        <CustomRangePicker
          active={props.period === 'custom'}
          from={props.from}
          to={props.to}
          onApply={(f, t) => router.push(buildHref('custom', f, t))}
        />
      </div>

      {/* Cloud + side panel */}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <WordCloudChart
          words={props.words}
          selectedWord={selectedWord}
          onSelectWord={(w) =>
            setSelectedWord((current) => (current === w ? null : w))
          }
        />
        <aside
          className="rounded-lg border p-4 space-y-3 h-fit"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div
                    className="text-lg font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {selected.text}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {selected.count} mention{selected.count === 1 ? '' : 's'} in{' '}
                    {selectedPosts.length} post
                    {selectedPosts.length === 1 ? '' : 's'}
                    {selected.trending && (
                      <>
                        {' · '}
                        <span style={{ color: 'var(--accent)' }}>trending</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedWord(null)}
                  className="text-sm"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Clear selection"
                >
                  ✕
                </button>
              </div>
              <ul className="space-y-2 max-h-[420px] overflow-y-auto">
                {selectedPosts.map((p) => (
                  <li
                    key={p.activity_id}
                    className="rounded border p-3 text-sm"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <Link
                      href={`/posts/${p.activity_id}`}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <div className="font-medium line-clamp-2">
                        {p.post_content.slice(0, 140)}
                        {p.post_content.length > 140 ? '…' : ''}
                      </div>
                      <div
                        className="text-xs mt-1 flex gap-3"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <span>{p.post_date}</span>
                        <span>{p.impressions.toLocaleString()} imp.</span>
                        <span>{p.reactions} rx</span>
                        <span>{p.comments} cm</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div
              className="text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Click a word to see the posts that mention it. Trending words (≥2×
              vs. the prior comparable period) are highlighted in the accent
              color.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function CustomRangePicker({
  active,
  from,
  to,
  onApply,
}: {
  active: boolean;
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={f}
        onChange={(e) => setF(e.target.value)}
        className="px-2 py-1 rounded border text-sm"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      />
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <input
        type="date"
        value={t}
        onChange={(e) => setT(e.target.value)}
        className="px-2 py-1 rounded border text-sm"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      />
      <button
        onClick={() => onApply(f, t)}
        className="px-3 py-1.5 rounded-full text-sm font-medium border"
        style={{
          backgroundColor: active ? 'var(--accent)' : 'var(--bg-card)',
          color: active ? '#ffffff' : 'var(--text-primary)',
          borderColor: active ? 'var(--accent)' : 'var(--border)',
        }}
      >
        Custom
      </button>
    </div>
  );
}
