import { describe, expect, it } from 'vitest';

import { homeOf, isSharedPath, modeFor } from '@/lib/mode';

describe('modeFor', () => {
  it('reads grammar off the URL', () => {
    expect(modeFor('/grammar', null)).toBe('grammar');
    expect(modeFor('/grammar/add', 'word')).toBe('grammar');
    expect(modeFor('/grammar/list', null)).toBe('grammar');
  });

  it('every word screen is vocabulary, whatever was remembered', () => {
    for (const path of ['/', '/practice', '/add', '/add/bulk', '/words', '/kanji', '/kanji/開']) {
      expect(modeFor(path, 'grammar')).toBe('word');
    }
  });

  /** A prefix is not a segment: /grammarian is not under /grammar. */
  it('matches whole path segments only', () => {
    expect(modeFor('/grammarian', 'grammar')).toBe('word');
    expect(modeFor('/statsx', 'grammar')).toBe('word');
  });

  it('stats and settings keep the mode you came from', () => {
    expect(modeFor('/stats', 'grammar')).toBe('grammar');
    expect(modeFor('/settings', 'grammar')).toBe('grammar');
    expect(modeFor('/stats', 'word')).toBe('word');
    expect(modeFor('/settings', null)).toBe('word');
    expect(modeFor('/stats', 'nonsense')).toBe('word');
  });

  /**
   * `ThemeScript` inlines this function's source to set the palette before
   * first paint. If it ever reaches for anything outside itself, the inlined
   * copy throws — and the page silently paints in the wrong colours.
   */
  it('works when inlined from its own source', () => {
    const inlined = new Function(`return (${modeFor.toString()})`)() as typeof modeFor;
    expect(inlined('/grammar/add', null)).toBe('grammar');
    expect(inlined('/stats', 'grammar')).toBe('grammar');
    expect(inlined('/', 'grammar')).toBe('word');
  });
});

describe('isSharedPath', () => {
  it('is only stats and settings', () => {
    expect(isSharedPath('/stats')).toBe(true);
    expect(isSharedPath('/settings')).toBe(true);
    expect(isSharedPath('/')).toBe(false);
    expect(isSharedPath('/grammar')).toBe(false);
  });
});

describe('homeOf', () => {
  it('is each mode’s review screen', () => {
    expect(homeOf('word')).toBe('/');
    expect(homeOf('grammar')).toBe('/grammar');
  });
});
