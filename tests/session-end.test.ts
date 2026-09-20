import { describe, expect, it } from 'vitest';

import { dropUnsettled, finishState } from '@/lib/session-end';
import type { ReviewItem } from '@/lib/types';

/**
 * What the reviewer says once the queue empties.
 *
 * Six states, and the one that matters is the one that could not exist while
 * the caps were daily: there is more, and you can have it now.
 */
/**
 * Practice ends differently, because none of the five review endings says
 * anything true about it: no backlog to report, no date to come back for,
 * nothing in flight to wait on, and always another page.
 */
describe('finishState, practising', () => {
  const base = {
    answered: 100,
    totalCards: 400,
    remaining: { newCards: 0, reviewCards: 0 },
    nextDue: null as string | null,
    canDeal: true,
    unsettled: false,
  };

  it('reports the page rather than what is due', () => {
    expect(finishState({ ...base, practice: { page: 1, pages: 8 } })).toEqual({
      kind: 'practice-done',
      page: 1,
      pages: 8,
      canDeal: true,
    });
  });

  /**
   * Practice queues nothing, so there is never a rating in flight for the
   * next page to collide with — the reviewer's state must not leak in.
   */
  it('is never waiting for a sync it cannot be waiting for', () => {
    const state = finishState({ ...base, unsettled: true, practice: { page: 0, pages: 3 } });
    expect(state.kind).toBe('practice-done');
  });

  /** Offline with a spent lookahead still needs the network for the next page. */
  it('carries the cannot-deal flag so the button can say why', () => {
    const state = finishState({ ...base, canDeal: false, practice: { page: 2, pages: 3 } });
    expect(state).toMatchObject({ kind: 'practice-done', canDeal: false });
  });

  /**
   * Nothing to drill is not an empty collection: the words may all be waiting
   * for their first review, and "add your first word" would be the wrong
   * advice for someone holding two hundred of them.
   */
  it('says nothing has been studied rather than nothing exists', () => {
    const state = finishState({ ...base, totalCards: 0, practice: { page: 0, pages: 1 } });
    expect(state).toEqual({ kind: 'practice-empty' });
  });

  it('leaves the reviewer alone when no page is given', () => {
    expect(finishState(base).kind).toBe('all-clear');
  });
});

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
