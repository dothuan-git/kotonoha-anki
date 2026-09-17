import { describe, expect, it } from 'vitest';

import { STALE_PAYLOAD_MS, chooseSession, isSessionView } from '@/lib/client/session';
import type { SessionView } from '@/lib/types';

/**
 * The offline resume rule.
 *
 * Worth its own tests because getting it wrong is silent and expensive in both
 * directions. Prefer the client too eagerly and reviews are replayed that were
 * already answered; prefer the server too eagerly and a queue is swapped out
 * from under someone mid-session, losing the ratings sitting in the outbox.
 */

const NOW = new Date('2026-03-01T10:00:00.000Z');

function session(now: Date): SessionView {
  return {
    now: now.toISOString(),
    items: [],
    next: [],
    cardsPerSession: 50,
    requestRetention: 0.9,
    remaining: { newCards: 0, reviewCards: 0 },
    nextDue: null,
    totalCards: 0,
  };
}

const fresh = session(NOW);
const stored = session(new Date('2026-03-01T06:00:00.000Z'));

describe('chooseSession', () => {
  it('takes the server when there is nothing stored', () => {
    expect(
      chooseSession({ server: fresh, stored: null, pendingCount: 0, online: true, now: NOW }),
    ).toEqual({ session: fresh, source: 'server' });
  });

  /**
   * The ordinary case, and the one people get wrong: a stored session from
   * earlier in the day with nothing pending was synced, so the server's queue
   * already reflects it and is the better answer.
   */
  it('takes the server over a stored session that has already been synced', () => {
    const chosen = chooseSession({
      server: fresh,
      stored,
      pendingCount: 0,
      online: true,
      now: NOW,
    });
    expect(chosen.source).toBe('server');
  });

  /**
   * The gap the pair rule opened once ratings stopped waiting for their twin:
   * a word graded on one face already flushed within its own ten seconds, so
   * by the time the tab reopens the outbox is empty even though the session
   * is not. `pendingCount` alone can no longer tell "synced" from "finished".
   */
  it('resumes an unfinished stored session even with nothing pending', () => {
    const midway: SessionView = { ...stored, items: [{ cardId: 'w1' } as never] };
    const chosen = chooseSession({
      server: fresh,
      stored: midway,
      pendingCount: 0,
      online: true,
      now: NOW,
    });
    expect(chosen).toEqual({ session: midway, source: 'resumed' });
  });

  it('resumes when ratings are still waiting in the outbox', () => {
    // Not preference — the server's queue still contains cards that have been
    // reviewed, because it has not been told about them yet.
    const chosen = chooseSession({
      server: fresh,
      stored,
      pendingCount: 1,
      online: true,
      now: NOW,
    });
    expect(chosen).toEqual({ session: stored, source: 'resumed' });
  });

  it('resumes when offline', () => {
    const chosen = chooseSession({
      server: fresh,
      stored,
      pendingCount: 0,
      online: false,
      now: NOW,
    });
    expect(chosen.source).toBe('resumed');
  });

  /**
   * A document served from the service worker's cache carries whatever session
   * was rendered the last time there was signal. Its timestamp is the only
   * thing that distinguishes it from a live render.
   */
  it('resumes when the payload is a stale cached render', () => {
    const cached = session(new Date(NOW.getTime() - STALE_PAYLOAD_MS - 1_000));
    const chosen = chooseSession({
      server: cached,
      stored,
      pendingCount: 0,
      online: true,
      now: NOW,
    });
    expect(chosen).toEqual({ session: stored, source: 'resumed' });
  });

  it('still believes a payload that is merely a few seconds old', () => {
    const slow = session(new Date(NOW.getTime() - 5_000));
    const chosen = chooseSession({
      server: slow,
      stored,
      pendingCount: 0,
      online: true,
      now: NOW,
    });
    expect(chosen.source).toBe('server');
  });
});

/**
 * The guard on the stored queue.
 *
 * This store is written by whatever build ran last, and a dev server compiles
 * through type errors — so the one thing it must never do is hand the reviewer
 * something that is not a session and take the screen down on load.
 */
describe('isSessionView', () => {
  const valid: SessionView = {
    now: '2026-02-01T09:00:00.000Z',
    items: [],
    next: [],
    cardsPerSession: 50,
    requestRetention: 0.9,
    remaining: { newCards: 0, reviewCards: 0 },
    nextDue: null,
    totalCards: 0,
  };

  it('accepts a session', () => {
    expect(isSessionView(valid)).toBe(true);
  });

  /** The shape a half-finished build actually wrote: the session, wrapped. */
  it('rejects a session wrapped in something else', () => {
    expect(isSessionView({ session: valid, graded: {} })).toBe(false);
  });

  it('rejects a session missing what the first render reads', () => {
    const { cardsPerSession: _dropped, ...withoutSize } = valid;
    expect(isSessionView(withoutSize)).toBe(false);
    expect(isSessionView({ ...valid, items: undefined })).toBe(false);
    expect(isSessionView({ ...valid, next: undefined })).toBe(false);
    expect(isSessionView({ ...valid, requestRetention: '0.9' })).toBe(false);
  });

  /**
   * The store survives a deploy, so the guard has to reject what the build
   * before this one wrote — a record with daily caps and no session size.
   */
  it('rejects a session written before the per-session change', () => {
    expect(
      isSessionView({
        now: '2026-02-01T09:00:00.000Z',
        items: [],
        countedCards: {},
        limits: { newPerDay: 12, reviewsPerDay: 100, unlimited: false },
        requestRetention: 0.9,
        heldBack: { newCards: 0, reviewCards: 0 },
        nextDayStart: '2026-02-02T21:00:00.000Z',
        totalCards: 0,
      }),
    ).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isSessionView(null)).toBe(false);
    expect(isSessionView(undefined)).toBe(false);
    expect(isSessionView('session')).toBe(false);
  });
});
