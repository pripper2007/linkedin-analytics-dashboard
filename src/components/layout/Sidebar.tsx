'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { OWNER } from '@/lib/site-config';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface SidebarProps {
  /** Mobile drawer state. Ignored at >=md breakpoint (sidebar is always visible there). */
  isOpen?: boolean;
  /** Called when a nav item is clicked, so the parent can close the mobile drawer. */
  onClose?: () => void;
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"
        />
      </svg>
    ),
  },
  {
    label: 'Posts',
    href: '/posts',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2h-3l-4 4z"
        />
      </svg>
    ),
  },
  {
    label: 'Optimization',
    href: '/optimization',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
  {
    label: 'Audience',
    href: '/audience',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.856-1.487M15 10a3 3 0 11-6 0 3 3 0 016 0zM4.318 6.318a4 4 0 015.364 0A4 4 0 015.639 7.639M9 20H4v-2a6 6 0 016-6h.01"
        />
      </svg>
    ),
  },
  {
    label: 'Idea Cloud',
    href: '/idea-cloud',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
        />
      </svg>
    ),
  },
  {
    label: 'Engagement Habits',
    href: '/activity',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
    ),
  },
  {
    label: 'Earned Media',
    href: '/earned-media',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    label: 'Network',
    href: '/network',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.658 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
      </svg>
    ),
  },
  {
    label: 'Data Health',
    href: '/data-health',
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
];

export default function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  // Mobile (<md): drawer slides in from the left when isOpen.
  // Desktop (>=md): always-visible fixed sidebar (transform reset by md: classes).
  // z-50 sits above the AppShell's z-40 backdrop on mobile.
  return (
    <aside
      className={`fixed left-0 top-0 h-screen w-60 z-50 flex flex-col bg-slate-900 border-r border-slate-800 transform transition-transform duration-200 ease-in-out md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Profile Section */}
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
            {OWNER.initials}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">
              {OWNER.name || 'LinkedIn Analytics'}
            </div>
            <div className="text-xs text-slate-400">
              {OWNER.title || 'Self-hosted dashboard'}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation. onClick closes the mobile drawer (no-op on desktop since
          the drawer is always open there). */}
      <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} onClick={() => onClose?.()}>
            <div
              className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
              style={{
                backgroundColor: isActive(item.href)
                  ? 'rgba(59, 130, 246, 0.1)'
                  : 'transparent',
                color: isActive(item.href) ? '#3b82f6' : '#cbd5e1',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-800">
        <div className="text-xs text-slate-500 text-center">
          LinkedIn Analytics v1.0
        </div>
      </div>
    </aside>
  );
}
