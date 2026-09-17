import { describe, expect, it } from 'vitest';

import { rateLocally } from '@/lib/fsrs/local';
import { schedulerParams } from '@/lib/fsrs/params';
import { emptyCard, foldLogs, type RatingValue, type ReplayLog } from '@/lib/fsrs/replay';
import { toCard, toStateView } from '@/lib/fsrs/state';
import type { ReviewItem, WordView } from '@/lib/types';

/**
 * The load-bearing claim behind offline review: the session can run on the
 * device and the server can replay it afterwards without the two disagreeing
 * about where the card ended up.
 *
 * That claim rests on two things, and this file tests both. The state view has
 * to round-trip to a real ts-fsrs card — otherwise the client resumes a
 * learning card from the wrong step — and rating incrementally on the client
 * has to land exactly where folding the resulting log lands on the server.
 */

const RETENTION = 0.9;
const params = schedulerParams(RETENTION);
const created = new Date('2026-02-01T08:00:00.000Z');

const word: WordView = {
  id: 'w0000000-0000-4000-8000-000000000001',
  headword: '開ける',
  reading: 'あける',
  meaning: 'mở',
  pos: 'Verb 2',
  transitivity: 'transitive',
  jlpt: 'N5',
  note: null,
  suspended: false,
  createdAt: created.toISOString(),
  kanji: [],
  sentences: [],
};

const CARD_ID = 'c0000000-0000-4000-8000-000000000001';

function item(
  state = toStateView(emptyCard(created)),
  isNew = true,
  leechAcked = false,
): ReviewItem {
  return {
    cardId: CARD_ID,
    face: 'word',
    isNew,
    word,
    state,
    previews: { 1: '', 2: '', 3: '', 4: '' },
    leechAcked,
  };
}

/**
 * A session as the device would run it: rate, take the state that came back,
 * rate again. No server anywhere.
 */
function runLocally(script: readonly { rating: RatingValue; at: string }[]) {
  let current = item();
  const logs: ReplayLog[] = [];

  script.forEach((step, i) => {
    const { result, pending } = rateLocally({
      logId: `a1000000-0000-4000-8000-00000000000${i + 1}`,
      item: current,
      rating: step.rating,
      now: new Date(step.at),
      requestRetention: RETENTION,
    });
    logs.push({
      id: pending.id,
      rating: pending.rating,
      reviewedAt: new Date(pending.reviewedAt),
    });
    current = { ...current, isNew: false, state: result.state };
  });

  return { state: current.state, logs };
}

describe('toStateView / toCard', () => {
  it('round-trips an untouched card', () => {
    const view = toStateView(emptyCard(created));
    expect(toStateView(toCard(view))).toEqual(view);
  });

  it('reports stability and difficulty as unmeasured on a new card', () => {
    const view = toStateView(emptyCard(created));
    expect(view.stability).toBeNull();
    expect(view.difficulty).toBeNull();
    // …and rebuilds to ts-fsrs's own representation of the same thing.
    expect(toCard(view).stability).toBe(0);
    expect(toCard(view).difficulty).toBe(0);
  });

  it('round-trips a card part-way through its learning steps', () => {
    const { state } = runLocally([{ rating: 3, at: '2026-02-01T09:00:00Z' }]);
    expect(state.learningSteps).toBe(1);
    expect(toStateView(toCard(state))).toEqual(state);
  });

  /**
   * The field `card_states` does not store, and the reason this module exists.
   *
   * One Được on a new card leaves it on the second of ['1m', '10m']. The next
   * Được graduates it — to two days out. A client that resumed without knowing
   * which step it was on would put the same card back in ten minutes instead,
   * every time, and the card would never leave learning.
   */
  it('needs the learning step to graduate a card rather than loop it', () => {
    const { state } = runLocally([{ rating: 3, at: '2026-02-01T09:00:00Z' }]);
    const at = new Date('2026-02-01T09:10:00Z');

    const kept = rateLocally({
      logId: 'a1000000-0000-4000-8000-0000000000a1',
      item: item(state, false),
      rating: 3,
      now: at,
      requestRetention: RETENTION,
    });
    const forgotten = rateLocally({
      logId: 'a1000000-0000-4000-8000-0000000000a2',
      item: item({ ...state, learningSteps: 0 }, false),
      rating: 3,
      now: at,
      requestRetention: RETENTION,
    });

    expect(kept.result.repeat).toBe(false);
    expect(forgotten.result.repeat).toBe(true);
  });
});

describe('rateLocally', () => {
  const script = [
    { rating: 3, at: '2026-02-01T09:00:00Z' },
    { rating: 3, at: '2026-02-01T09:10:00Z' },
    { rating: 1, at: '2026-02-04T20:00:00Z' },
    { rating: 3, at: '2026-02-04T20:11:00Z' },
    { rating: 4, at: '2026-02-12T07:30:00Z' },
  ] as const;

  /**
   * The whole point. A session rated offline, then replayed by the server the
   * way /api/sync replays it, has to arrive at the same card — otherwise the
   * client's local scheduling was a lie that the reconnect quietly corrects.
   */
  it('lands where a server-side fold of the same log lands', () => {
    const { state, logs } = runLocally(script);
    expect(toStateView(foldLogs(created, logs, params))).toEqual(state);
  });

  it('agrees whatever order the log reaches the server in', () => {
    const { state, logs } = runLocally(script);
    const shuffled = [logs[3], logs[0], logs[4], logs[2], logs[1]].filter(
      (l): l is ReplayLog => l !== undefined,
    );
    expect(toStateView(foldLogs(created, shuffled, params))).toEqual(state);
  });

  it('writes the device clock as reviewed_at, not the moment of sync', () => {
    const { logs } = runLocally([{ rating: 3, at: '2026-02-01T09:00:00Z' }]);
    expect(logs[0]?.reviewedAt.toISOString()).toBe('2026-02-01T09:00:00.000Z');
  });

  /**
   * A phone whose clock steps backwards mid-session — a timezone change, an
   * NTP correction — would otherwise write a row that sorts before the card's
   * own history and refold it into something else.
   */
  it('never writes a review at or before the card’s last one', () => {
    const first = rateLocally({
      logId: 'a1000000-0000-4000-8000-000000000001',
      item: item(),
      rating: 3,
      now: new Date('2026-02-01T09:00:00Z'),
      requestRetention: RETENTION,
    });

    const second = rateLocally({
      logId: 'a1000000-0000-4000-8000-000000000002',
      item: item(first.result.state, false),
      rating: 3,
      // Earlier than the first review.
      now: new Date('2026-02-01T08:30:00Z'),
      requestRetention: RETENTION,
    });

    expect(Date.parse(second.pending.reviewedAt)).toBeGreaterThan(
      Date.parse(first.pending.reviewedAt),
    );
  });

  it('keeps a learning card inside the session and sends a mature one away', () => {
    const again = runLocally([{ rating: 1, at: '2026-02-01T09:00:00Z' }]);
    expect(toCard(again.state).due.getTime()).toBeLessThan(
      new Date('2026-02-01T09:20:00Z').getTime(),
    );

    const easy = rateLocally({
      logId: 'a1000000-0000-4000-8000-00000000000f',
      item: item(),
      rating: 4,
      now: new Date('2026-02-01T09:00:00Z'),
      requestRetention: RETENTION,
    });
    expect(easy.result.repeat).toBe(false);
  });

});
