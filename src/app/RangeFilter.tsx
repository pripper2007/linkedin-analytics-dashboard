'use client';

// Range filter for the Executive Summary and the Post Performance page.
// Pushes the selected range into the URL (`?range=30d` or
// `?range=custom&from=…&to=…`) so the server-rendered page re-runs with
// the new window. Keeping state in the URL means deep links and
// back-button navigation "just work".
//
// `basePath` is the path the filter pushes to. Defaults to `/` for the
// dashboard; pass `/growth` (or whatever route hosts the filter) to
// reuse this component without forcing a navigate-to-home on apply.

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  RANGE_OPTIONS,
  DEFAULT_RANGE,
  type RangePreset,
} from '@/lib/date-range';

interface RangeFilterProps {
  basePath?: string;
}

export function RangeFilter({ basePath = '/' }: RangeFilterProps = {}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const initialPreset = (sp.get('range') as RangePreset) ?? DEFAULT_RANGE;
  const [preset, setPreset] = useState<RangePreset>(
    RANGE_OPTIONS.some((o) => o.value === initialPreset) ? initialPreset : DEFAULT_RANGE,
  );
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');

  const push = (next: URLSearchParams) => {
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath));
  };

  const onPresetChange = (value: RangePreset) => {
    setPreset(value);
    if (value === 'custom') return; // wait for Apply with both dates
    const params = new URLSearchParams();
    if (value !== DEFAULT_RANGE) params.set('range', value);
    push(params);
  };

  const onApplyCustom = () => {
    if (!from || !to) return;
    const params = new URLSearchParams();
    params.set('range', 'custom');
    params.set('from', from);
    params.set('to', to);
    push(params);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        className="text-xs uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        Range
      </label>
      <select
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as RangePreset)}
        disabled={pending}
        className="text-sm px-3 py-1.5 rounded"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      >
        {RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {preset === 'custom' && (
        <>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={pending}
            className="text-sm px-2 py-1.5 rounded"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          />
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={pending}
            className="text-sm px-2 py-1.5 rounded"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          />
          <button
            type="button"
            onClick={onApplyCustom}
            disabled={pending || !from || !to}
            className="text-sm px-3 py-1.5 rounded font-medium disabled:opacity-50"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'white',
            }}
          >
            Apply
          </button>
        </>
      )}
    </div>
  );
}
