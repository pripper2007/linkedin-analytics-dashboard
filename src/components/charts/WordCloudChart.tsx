'use client';

// D3-cloud-based word cloud. d3-cloud computes a spiral layout on a
// detached canvas (needs browser APIs) so this must be a client component.
//
// We compute the layout once per props change in a useEffect and render
// the result as SVG so it's theme-aware via CSS custom properties and
// keyboard-focusable for click-to-filter interactions.

import { useEffect, useMemo, useRef, useState } from 'react';
import cloud from 'd3-cloud';

export interface WordCloudWord {
  text: string;
  count: number;
  trending: boolean;
}

interface LaidOutWord extends WordCloudWord {
  x: number;
  y: number;
  size: number;
  rotate: number;
}

interface Props {
  words: WordCloudWord[];
  selectedWord: string | null;
  onSelectWord: (word: string) => void;
  width?: number;
  height?: number;
}

// Font-size mapping: scale by sqrt(count) rather than rank so that the
// top word visually towers over the rest. Rank-linear made every word
// look similar — sqrt on raw count gives a proper hierarchy while
// avoiding the wild extremes of linear-on-raw-count (where one viral
// word could dwarf everything else by 10×).
//
// MAX_FONT bumped from 56 → 72 per user feedback.
const MIN_FONT = 12;
const MAX_FONT = 72;

function sizeForCount(count: number, maxCount: number): number {
  if (maxCount <= 0) return MIN_FONT;
  // Normalized sqrt scale. The top word hits MAX_FONT; words whose
  // count is 25% of the max land at ~50% of the font range (because
  // √0.25 = 0.5), which gives the visual hierarchy the user wanted.
  const t = Math.sqrt(count / maxCount);
  return MIN_FONT + (MAX_FONT - MIN_FONT) * t;
}

export default function WordCloudChart({
  words,
  selectedWord,
  onSelectWord,
  width = 960,
  height = 520,
}: Props) {
  const [laidOut, setLaidOut] = useState<LaidOutWord[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Each word carries its target pixel size so d3-cloud can pack them.
  const sized = useMemo(() => {
    const maxCount = words.reduce((m, w) => Math.max(m, w.count), 0);
    return words.map((w) => ({
      ...w,
      size: sizeForCount(w.count, maxCount),
    }));
  }, [words]);

  useEffect(() => {
    if (!sized.length) {
      setLaidOut([]);
      return;
    }
    // d3-cloud is async (uses requestAnimationFrame under the hood). It
    // mutates items in-place, adding x/y/size/rotate properties.
    const layout = cloud<WordCloudWord & { size: number }>()
      .size([width, height])
      .words(sized)
      .padding(3)
      .rotate(() => (Math.random() < 0.5 ? 0 : 90))
      .font('Inter, system-ui, sans-serif')
      .fontSize((d) => d.size)
      .on('end', (placed) => {
        // After layout, d3-cloud mutates each item in-place with x, y,
        // rotate, size. The return type doesn't declare those fields,
        // so we cast through a widened shape here.
        type Placed = WordCloudWord & {
          size: number;
          x?: number;
          y?: number;
          rotate?: number;
        };
        setLaidOut(
          (placed as unknown as Placed[]).map((p) => ({
            text: p.text,
            count: p.count,
            trending: p.trending,
            size: p.size ?? MIN_FONT,
            x: p.x ?? 0,
            y: p.y ?? 0,
            rotate: p.rotate ?? 0,
          })),
        );
      });
    layout.start();
  }, [sized, width, height]);

  if (!words.length) {
    return (
      <div
        className="rounded-lg border flex items-center justify-center"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border)',
          color: 'var(--text-muted)',
          minHeight: height,
        }}
      >
        No posts in this period.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg border overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        <g transform={`translate(${width / 2}, ${height / 2})`}>
          {laidOut.map((w) => {
            const isSelected = selectedWord === w.text;
            const isDim =
              selectedWord !== null && selectedWord !== w.text ? 0.25 : 1;
            const color = w.trending
              ? 'var(--accent)' // trending words use the accent blue
              : isSelected
                ? 'var(--accent)'
                : 'var(--text-primary)';
            return (
              <text
                key={w.text}
                textAnchor="middle"
                transform={`translate(${w.x}, ${w.y}) rotate(${w.rotate})`}
                fontSize={w.size}
                fontWeight={w.trending ? 700 : 500}
                fontFamily="Inter, system-ui, sans-serif"
                fill={color}
                opacity={isDim}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                onClick={() => onSelectWord(w.text)}
              >
                <title>{`${w.text}: ${w.count}${w.trending ? ' (trending)' : ''}`}</title>
                {w.text}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
