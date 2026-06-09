'use client';

// Top-level layout shell with mobile-friendly nav.
//
// Owns the mobile drawer open/closed state and passes it to Sidebar
// (which renders as a slide-in panel below md breakpoint) and Header
// (which gets a hamburger button below md breakpoint). Above md
// (≥768px) the layout is the original fixed-sidebar desktop view —
// every mobile-only behavior is gated behind `md:` Tailwind classes
// so the desktop experience is byte-identical.

import { ReactNode, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';

export default function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // The /login page is a standalone full-screen card; rendering the
  // sidebar+header chrome around an unauthenticated user would expose
  // navigation links that all redirect back to /login (confusing) and
  // the user-profile block (Pedro's name) that has no business there.
  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-white dark:bg-slate-950">
      {/* Mobile-only backdrop. Click anywhere outside the drawer closes it.
          Above md the sidebar is permanent, so this overlay is hidden. */}
      {navOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar isOpen={navOpen} onClose={() => setNavOpen(false)} />

      {/* min-w-0 stops the flex column from being widened by an oversized
          child (intrinsic min-width: auto is the flexbox default and lets
          a single wide table or chart push the whole page past viewport
          width on mobile). overflow-x-hidden on main is belt-and-braces:
          even if a child does measure too wide, the bleed is clipped
          rather than producing a horizontal page scroll. */}
      <div className="flex-1 min-w-0 flex flex-col md:ml-60">
        <Header onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pt-20 px-4 md:px-8 pb-8 bg-white dark:bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}
