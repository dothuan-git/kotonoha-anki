import { describe, expect, it } from 'vitest';

import { STALE_PAYLOAD_MS, chooseSession } from '@/lib/client/session';
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

function session(now: Date, label: string): SessionView {
  return {
    now: now.toISOString(),
    items: [],
    countedCards: { [label]: 'review' },
    limits: { newPerDay: 12, reviewsPerDay: 100 },
    requestRetention: 0.9,
    heldBack: { newCards: 0, reviewCards: 0 },
    nextDue: null,
    nextDayStart: '2026-03-01T21:00:00.000Z',
    totalCards: 0,
  };
}

const fresh = session(NOW, 'server');
const stored = session(new Date('2026-03-01T06:00:00.000Z'), 'stored');

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
    const cached = session(new Date(NOW.getTime() - STALE_PAYLOAD_MS - 1_000), 'cached');
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
    const slow = session(new Date(NOW.getTime() - 5_000), 'slow');
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
