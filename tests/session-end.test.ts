import { describe, expect, it } from 'vitest';

import { dropUnsettled, finishState } from '@/lib/session-end';
import type { ReviewItem } from '@/lib/types';

/**
 * What the reviewer says once the queue empties.
 *
 * Six states, and the one that matters is the one that could not exist while
 * the caps were daily: there is more, and you can have it now.
 */
describe('finishState', () => {
  const base = {
    answered: 20,
    totalCards: 400,
    remaining: { newCards: 0, reviewCards: 0 },
    nextDue: null as string | null,
    canDeal: true,
    unsettled: false,
  };

  it('offers the next session when work is waiting', () => {
    const state = finishState({ ...base, remaining: { newCards: 3, reviewCards: 50 } });
    expect(state).toEqual({
      kind: 'more-waiting',
      remaining: { newCards: 3, reviewCards: 50 },
      canDeal: true,
    });
  });

  /**
   * Offline with no lookahead left is still "there is more" — the button is
   * disabled with a reason rather than the screen pretending you are done.
   */
  it('carries the cannot-deal flag through rather than hiding the state', () => {
    const state = finishState({
      ...base,
      remaining: { newCards: 0, reviewCards: 10 },
      canDeal: false,
    });
    expect(state).toMatchObject({ kind: 'more-waiting', canDeal: false });
  });

  it('says the collection is clear when nothing is left', () => {
    const state = finishState({ ...base, nextDue: '2026-09-20T02:00:00.000Z' });
    expect(state).toEqual({
      kind: 'all-clear',
      nextDue: '2026-09-20T02:00:00.000Z',
      outOfNewWords: true,
    });
  });

  /** Nothing answered and nothing due is a different screen from a finished one. */
  it('distinguishes an empty open from a finished session', () => {
    expect(finishState({ ...base, answered: 0 })).toEqual({ kind: 'nothing-due', nextDue: null });
    expect(finishState({ ...base, answered: 1 })).toMatchObject({ kind: 'all-clear' });
  });

  it('still offers the next session when nothing was answered but work waits', () => {
    // Opening straight into a budget that could not reach everything.
    const state = finishState({
      ...base,
      answered: 0,
      remaining: { newCards: 0, reviewCards: 80 },
    });
    expect(state).toMatchObject({ kind: 'more-waiting' });
  });

  it('puts an empty collection ahead of every other reason', () => {
    const state = finishState({
      ...base,
      totalCards: 0,
      remaining: { newCards: 9, reviewCards: 9 },
      unsettled: true,
    });
    expect(state).toEqual({ kind: 'empty-collection' });
  });

  it('puts ratings still in flight ahead of a finished session', () => {
    const state = finishState({ ...base, unsettled: true });
    expect(state).toEqual({ kind: 'waiting-for-sync' });
  });
});

/**
 * The undo window means the tail of a finished session is still local when the
 * next one is dealt, and those cards still look due to the server.
 */
describe('dropUnsettled', () => {
  const showing = (cardId: string, face: 'word' | 'meaning'): ReviewItem =>
    ({ cardId, face }) as unknown as ReviewItem;

  const items = [
    showing('a', 'word'),
    showing('b', 'word'),
    showing('a', 'meaning'),
    showing('c', 'word'),
    showing('b', 'meaning'),
    showing('c', 'meaning'),
  ];

  /** Half a pair is worse than neither: the second face revises the first. */
  it('drops both faces of a card, never one', () => {
    const kept = dropUnsettled(items, new Set(['a']));
    expect(kept.map((i) => i.cardId)).toEqual(['b', 'c', 'b', 'c']);
  });

  it('leaves everything else in the order it was dealt', () => {
    const kept = dropUnsettled(items, new Set(['b']));
    expect(kept.map((i) => `${i.cardId}:${i.face}`)).toEqual([
      'a:word',
      'a:meaning',
      'c:word',
      'c:meaning',
    ]);
  });

  it('is a copy, not the same array, when nothing is unsettled', () => {
    const kept = dropUnsettled(items, new Set());
    expect(kept).toEqual(items);
    expect(kept).not.toBe(items);
  });

  it('can empty the queue outright', () => {
    expect(dropUnsettled(items, new Set(['a', 'b', 'c']))).toEqual([]);
  });
});
