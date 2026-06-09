import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import AppShell from '@/components/layout/AppShell';
import { siteTitle } from '@/lib/site-config';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: siteTitle,
  description:
    'Advanced LinkedIn analytics dashboard for content performance and audience insights',
};

// Default viewport — width=device-width is what makes mobile browsers
// render at the actual screen width instead of the desktop-default 980px
// "make-it-fit" zoom. Without this the mobile drawer + Tailwind's `md:`
// breakpoint would be evaluated against a 980px-wide simulation, not the
// real phone width, and the desktop layout would still render.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
