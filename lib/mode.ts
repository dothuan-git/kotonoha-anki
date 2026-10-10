import type { CardKind } from '@/lib/types';

/**
 * The study mode — vocabulary or grammar — which decides the tab set in the
 * nav and the palette (bamboo or momiji).
 *
 * Read off the URL wherever the URL can say: the grammar screens live under
 * /grammar and the word screens do not, so a reload or a bookmark always lands
 * in the right mode. /stats and /settings serve both, and keep whichever mode
 * you came from — `remembered`, kept in a cookie so the server renders the
 * same tab set the client will.
 */

/** The cookie the remembered mode lives in. Read by the layout and by `ThemeScript`. */
export const MODE_COOKIE = 'kotonoha-mode';

/**
 * Which mode a path is in.
 *
 * Self-contained on purpose — no imports, no outer constants — because
 * `ThemeScript` inlines its source to set the palette before first paint, and
 * a reference to anything outside the function would be undefined there.
 * `tests/mode.test.ts` runs the inlined copy to hold that.
 */
export function modeFor(pathname: string, remembered: string | null | undefined): CardKind {
  const under = (root: string) => pathname === root || pathname.indexOf(root + '/') === 0;
  if (under('/grammar')) return 'grammar';
  if (under('/stats') || under('/settings')) return remembered === 'grammar' ? 'grammar' : 'word';
  return 'word';
}

/** /stats and /settings: one page for both modes, which keeps the one you came from. */
export function isSharedPath(pathname: string): boolean {
  return modeFor(pathname, 'grammar') !== modeFor(pathname, 'word');
}

/** Where switching to a mode takes you from a page that belongs to one mode. */
export function homeOf(mode: CardKind): '/' | '/grammar' {
  return mode === 'grammar' ? '/grammar' : '/';
}
