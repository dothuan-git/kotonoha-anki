'use client';

import { useEffect, useState } from 'react';

export const THEME_KEY = 'kotonoha-theme';

/**
 * The washi / charcoal toggle, shared by the header and /settings.
 *
 * `ThemeScript` has already put the class on <html> before first paint, so
 * this only mirrors it into state once mounted — reading it during render
 * would disagree with the server's HTML and hydrate wrong. `dark` is
 * therefore false on the very first client render of a dark session; nothing
 * but the icon depends on it, and the page itself is already dark.
 */
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      // Private mode or blocked storage: the toggle still works for this session.
    }
  }

  return { dark, toggle };
}
