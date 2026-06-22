'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'argus_theme';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function ThemeToggle() {
  // Start from whatever the no-flash script applied; React just keeps it in
  // sync with subsequent clicks.
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => setTheme(readTheme()), []);

  function set(next: Theme) {
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // localStorage can throw in strict iframes; the visual swap still works.
    }
  }

  const cellBase =
    'px-2.5 py-1 rounded-md text-xs font-semibold transition outline-none';
  const active = 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-text';
  const inactive = 'text-text-3 hover:text-text-2';

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-inset p-0.5">
      <button
        type="button"
        onClick={() => set('light')}
        className={`${cellBase} ${theme === 'light' ? active : inactive}`}
        aria-label="Light theme"
      >
        Light
      </button>
      <button
        type="button"
        onClick={() => set('dark')}
        className={`${cellBase} ${theme === 'dark' ? active : inactive}`}
        aria-label="Dark theme"
      >
        Dark
      </button>
    </div>
  );
}

/**
 * No-flash theme bootstrap. Rendered as an inline <script> in the authed
 * root layout BEFORE React hydrates, so the html.dark class is on the
 * element when first paint happens.
 */
export const THEME_NOFLASH_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('${KEY}');
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
