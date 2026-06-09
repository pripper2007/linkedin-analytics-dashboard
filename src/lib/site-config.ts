// ---------------------------------------------------------------------------
// Owner identity — make the dashboard *yours* without touching components.
// Set these in .env(.local) and in your Vercel project. They use the
// NEXT_PUBLIC_ prefix so they're readable from both server components
// (layout, queries) and client components (sidebar, login form).
//
//   NEXT_PUBLIC_OWNER_NAME="Ada Lovelace"
//   NEXT_PUBLIC_OWNER_TITLE="Engineering Leader · Writer"
//
// Every field falls back to neutral copy when unset, so a fresh clone runs
// with no personalization at all.
// ---------------------------------------------------------------------------

const name = (process.env.NEXT_PUBLIC_OWNER_NAME ?? '').trim();
const title = (process.env.NEXT_PUBLIC_OWNER_TITLE ?? '').trim();

function initialsFrom(n: string): string {
  const out = n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return out || 'in';
}

export const OWNER = {
  /** Display name, or '' when unset. */
  name,
  /** Role / tagline shown under the name in the sidebar, or '' when unset. */
  title,
  /** 1–2 letter avatar initials; falls back to 'in' when no name is set. */
  initials: initialsFrom(name),
};

/** Browser tab / metadata title. */
export const siteTitle = name
  ? `LinkedIn Analytics | ${name}`
  : 'LinkedIn Analytics';

/** Login-screen subtitle. */
export const dashboardSubtitle = name
  ? `${name}'s dashboard`
  : 'Your self-hosted dashboard';

/**
 * IANA timezone used to bucket posts by weekday + hour for the posting-time
 * heatmap and cadence analysis. Set ANALYTICS_TIMEZONE to your own zone
 * (e.g. "America/New_York", "Europe/London") so the "best day / best hour"
 * insights reflect when your audience actually sees your posts. Server-side
 * only — defaults to the author's zone to preserve existing behavior.
 */
export const ANALYTICS_TIMEZONE =
  process.env.ANALYTICS_TIMEZONE || 'America/Sao_Paulo';
