'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { MODE_COOKIE, homeOf, isSharedPath, modeFor } from '@/lib/mode';
import type { CardKind } from '@/lib/types';

/** Showings waiting in the next session, per mode — the badges. */
export type DueCounts = Record<CardKind, number>;

interface StudyModeValue {
  mode: CardKind;
  due: DueCounts;
  /** Go to the other mode: its review screen, or the same shared page in its colours. */
  switchTo: (mode: CardKind) => void;
}

const StudyModeContext = createContext<StudyModeValue | null>(null);

/** A year: the mode is a preference, not a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function rememberMode(mode: CardKind) {
  try {
    document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // Blocked cookies: the mode still follows the URL, only /stats and
    // /settings forget which one you came from.
  }
}

/**
 * Vocabulary or grammar, for the header toggle and the nav.
 *
 * The mode is derived, not stored: `modeFor` reads it off the path, and the
 * only state here is which mode /stats and /settings should keep — seeded
 * from the cookie the layout read, so the server and the first client render
 * agree on the tab set.
 *
 * It also keeps `<html data-mode>` in step on client navigation. The first
 * paint was `ThemeScript`'s; after that a soft navigation runs no script, so
 * the palette would otherwise stay on whatever mode the tab was opened in.
 */
export function StudyModeProvider({
  remembered: initial,
  due,
  children,
}: {
  remembered: CardKind | null;
  due: DueCounts;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [remembered, setRemembered] = useState<CardKind | null>(initial);
  const mode = modeFor(pathname, remembered);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    // A page that belongs to one mode is a choice of that mode; a shared page
    // is not, so it changes nothing.
    if (!isSharedPath(pathname) && remembered !== mode) {
      setRemembered(mode);
      rememberMode(mode);
    }
  }, [pathname, mode, remembered]);

  const switchTo = useCallback(
    (next: CardKind) => {
      if (next === mode) return;
      if (isSharedPath(pathname)) {
        // Stats and settings serve both: stay, change colours, and re-render
        // on the server — /stats reads the mode from the cookie just written.
        setRemembered(next);
        rememberMode(next);
        router.refresh();
        return;
      }
      router.push(homeOf(next));
    },
    [mode, pathname, router],
  );

  const value = useMemo(() => ({ mode, due, switchTo }), [mode, due, switchTo]);
  return <StudyModeContext.Provider value={value}>{children}</StudyModeContext.Provider>;
}

export function useStudyMode(): StudyModeValue {
  const value = useContext(StudyModeContext);
  if (!value) throw new Error('useStudyMode outside StudyModeProvider');
  return value;
}
