'use client';

import { useState, useEffect } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (!isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  if (!mounted) {
    return (
      <button className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700 transition-colors">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zM4.343 4.343a1 1 0 011.414 0l.707.707a1 1 0 00-1.414-1.414l-.707.707zm11.314 0a1 1 0 000 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zM4 10a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm10 0a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zM4.343 15.657a1 1 0 000 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zm11.314 0a1 1 0 011.414 0l.707.707a1 1 0 10-1.414 1.414l-.707-.707zM10 18a1 1 0 01-1-1v-1a1 1 0 112 0v1a1 1 0 01-1 1zm4.243-2.757a1 1 0 000 1.414l.707.707a1 1 0 101.414-1.414l-.707-.707zM10 5a5 5 0 100 10 5 5 0 000-10z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <svg
          className="w-5 h-5 text-slate-900 dark:text-yellow-300"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
      ) : (
        <svg
          className="w-5 h-5 text-yellow-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zM4.343 4.343a1 1 0 011.414 0l.707.707a1 1 0 00-1.414-1.414l-.707.707zm11.314 0a1 1 0 000 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zM4 10a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm10 0a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zM4.343 15.657a1 1 0 000 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zm11.314 0a1 1 0 011.414 0l.707.707a1 1 0 10-1.414 1.414l-.707-.707zM10 18a1 1 0 01-1-1v-1a1 1 0 112 0v1a1 1 0 01-1 1zm4.243-2.757a1 1 0 000 1.414l.707.707a1 1 0 101.414-1.414l-.707-.707zM10 5a5 5 0 100 10 5 5 0 000-10z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
}
