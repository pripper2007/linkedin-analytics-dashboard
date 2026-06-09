'use client';

// Lightweight viewport-width hook for responsive chart props.
//
// Why not just Tailwind classes? Recharts axis widths/heights are JS
// props, not CSS — they affect SVG layout calculations, not styling. So
// when a chart needs to render with a smaller YAxis width on mobile, we
// have to know the viewport in JS at render time.
//
// SSR-safety: initial state is `false` so the server renders desktop
// dimensions. On mount, the effect reads window.innerWidth and updates;
// on a real mobile device this causes a brief flash of desktop-sized
// chart (~50ms) before re-rendering at mobile dimensions. Acceptable
// trade-off vs. a hydration mismatch warning, which is the alternative
// if we read window during SSR.

import { useEffect, useState } from 'react';

const MOBILE_MAX = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_MAX);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}
