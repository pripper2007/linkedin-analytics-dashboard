'use client';

import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

const pageNames: Record<string, string> = {
  '/': 'Dashboard',
  '/activity': 'Engagement Habits',
  '/posts': 'Posts Analytics',
  '/optimization': 'Post Optimization',
  '/audience': 'Audience Insights',
  '/network': 'Network Analysis',
  '/checklist': 'LinkedIn Scorecard',
};

interface HeaderProps {
  /** Mobile-only — clicked when the hamburger button is pressed. */
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps = {}) {
  const pathname = usePathname();
  const pageTitle = pageNames[pathname] || 'Dashboard';

  const getLastUpdated = () => {
    const now = new Date();
    const date = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return date;
  };

  // On mobile the sidebar is hidden, so the header spans the full width
  // (left-0). On desktop the header sits to the right of the 240px
  // sidebar (md:left-60). Padding shrinks on mobile to leave room for
  // the hamburger button + page title without crowding.
  return (
    <header className="fixed top-0 left-0 md:left-60 right-0 h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 z-30">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only. Aria-label rather than visible text
            keeps the header compact on narrow phones. */}
        <button
          type="button"
          onClick={() => onMenuClick?.()}
          className="md:hidden -ml-1 p-2 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Open navigation menu"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="text-base md:text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">
            {pageTitle}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 hidden sm:block">
            Last updated: {getLastUpdated()}
          </p>
        </div>
      </div>
      <ThemeToggle />
    </header>
  );
}
