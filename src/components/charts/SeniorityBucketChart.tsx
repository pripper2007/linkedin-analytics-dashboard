'use client';

// Seniority breakdown ordered by hierarchy (top → bottom = most → least
// senior) and visually grouped into three buckets so the eye reads the
// hierarchy at a glance:
//
//   Executive  — Owner, CXO, Partner, VP
//   Director   — Director, Senior
//   IC         — Manager, Entry, Training
//
// LinkedIn's seniority taxonomy doesn't ship "Founder" / "Co-Founder" /
// "Board Member" as distinct values — those are folded into Owner / CXO
// — so the user-facing wording in BUCKETS uses LinkedIn's labels.

interface Datum {
  name: string;
  value: number;
}

interface Props {
  data: Datum[];
}

type BucketId = 'executive' | 'director' | 'ic';

interface BucketDef {
  id: BucketId;
  label: string;
  /** Order matters: rendered top-to-bottom within the bucket. */
  members: string[];
  color: string;
}

// Hierarchical order. First bucket renders first (top of chart).
const BUCKETS: BucketDef[] = [
  {
    id: 'executive',
    label: 'Executive (Board / Founder / C-Suite / VP / Owner / Partner)',
    members: ['Owner', 'CXO', 'Partner', 'VP'],
    color: 'var(--accent)',
  },
  {
    id: 'director',
    label: 'Director',
    members: ['Director', 'Senior'],
    color: '#8b5cf6',
  },
  {
    id: 'ic',
    label: 'Manager & Individual Contributor',
    members: ['Manager', 'Entry', 'Training'],
    color: '#94a3b8',
  },
];

function bucketFor(name: string): BucketDef {
  for (const b of BUCKETS) {
    if (b.members.some((m) => m.toLowerCase() === name.toLowerCase())) return b;
  }
  return BUCKETS[2];
}

export default function SeniorityBucketChart({ data }: Props) {
  const valueMap = new Map(data.map((d) => [d.name, d.value]));
  const maxValue = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;

  // Rebuild the rendering list in bucket order, picking up only the
  // entries that actually have data. Anything we don't recognize (rare;
  // would only happen if LinkedIn introduces a new seniority value) gets
  // appended to the IC bucket so it isn't silently dropped.
  const knownNames = new Set(BUCKETS.flatMap((b) => b.members.map((m) => m.toLowerCase())));
  const unknown = data.filter((d) => !knownNames.has(d.name.toLowerCase()));

  return (
    <div className="card">
      <h3
        className="text-lg font-semibold mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        Seniority
      </h3>
      <p
        className="text-sm mb-4 leading-snug"
        style={{ color: 'var(--text-secondary)' }}
      >
        Average % of audience at each seniority level, ordered top → bottom by
        career rank and grouped into three tiers (Executive / Director / IC).
      </p>
      <div className="space-y-5">
        {BUCKETS.map((bucket) => {
          const rows = bucket.members
            .map((m) => ({ name: m, value: valueMap.get(m) ?? 0 }))
            .filter((r) => r.value > 0);
          if (bucket.id === 'ic' && unknown.length) {
            rows.push(...unknown);
          }
          if (rows.length === 0) return null;
          return (
            <div key={bucket.id}>
              <div
                className="flex items-center gap-2 mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span
                  className="inline-block w-2 h-4 rounded-sm"
                  style={{ backgroundColor: bucket.color }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {bucket.label}
                </span>
              </div>
              <div className="space-y-2">
                {rows.map((row) => {
                  const widthPct = Math.max(
                    2,
                    Math.round((row.value / maxValue) * 100),
                  );
                  return (
                    <div key={row.name} className="flex items-center gap-3">
                      <div
                        className="w-28 text-sm shrink-0"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {row.name}
                      </div>
                      <div
                        className="flex-1 h-6 rounded relative"
                        style={{ backgroundColor: 'var(--bg-secondary)' }}
                      >
                        <div
                          className="h-6 rounded"
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: bucket.color,
                          }}
                        />
                        <span
                          className="absolute top-1/2 -translate-y-1/2 text-xs font-medium"
                          style={{
                            left: `calc(${widthPct}% + 6px)`,
                            color: 'var(--text-primary)',
                          }}
                        >
                          {row.value.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
