import { describe, expect, it } from 'vitest';

import { schedulerParams } from '@/lib/fsrs/params';
import { foldLogs, sortLogs, type ReplayLog } from '@/lib/fsrs/replay';

/**
 * Log replay determinism.
 *
 * This is the property the whole design rests on. If a fold is not
 * reproducible, then `card_states` is real state pretending to be a
 * projection, undo cannot be "recompute from the log", and offline sync has
 * no way to resolve two devices.
 */

const params = schedulerParams(0.9);
const created = new Date('2026-01-01T09:00:00.000Z');

/** A plausible fortnight: learn, lapse, relearn, review. */
const LOGS: ReplayLog[] = [
  { id: 'a1000000-0000-4000-8000-000000000001', rating: 3, reviewedAt: iso('2026-01-01T09:00:00Z') },
  { id: 'a1000000-0000-4000-8000-000000000002', rating: 3, reviewedAt: iso('2026-01-01T09:10:00Z') },
  { id: 'a1000000-0000-4000-8000-000000000003', rating: 1, reviewedAt: iso('2026-01-03T20:00:00Z') },
  { id: 'a1000000-0000-4000-8000-000000000004', rating: 3, reviewedAt: iso('2026-01-03T20:11:00Z') },
  { id: 'a1000000-0000-4000-8000-000000000005', rating: 4, reviewedAt: iso('2026-01-08T07:30:00Z') },
  { id: 'a1000000-0000-4000-8000-000000000006', rating: 2, reviewedAt: iso('2026-01-30T07:30:00Z') },
];

function iso(s: string): Date {
  return new Date(s);
}

describe('foldLogs', () => {
  it('folds an empty log to a new card due when the word was created', () => {
    const card = foldLogs(created, [], params);
    expect(card.state).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.due.getTime()).toBe(created.getTime());
    expect(card.last_review).toBeUndefined();
  });

  it('is deterministic — the same log always folds to the same state', () => {
    const first = foldLogs(created, LOGS, params);
    const second = foldLogs(created, LOGS, params);
    expect(second).toEqual(first);
  });

  // enable_fuzz randomises intervals; ts-fsrs seeds that randomness from the
  // card itself, so it must not leak between folds of the same log.
  it('stays deterministic with fuzz enabled', () => {
    expect(params.enable_fuzz).toBe(true);
    const runs = Array.from({ length: 5 }, () => foldLogs(created, LOGS, params).due.getTime());
    expect(new Set(runs).size).toBe(1);
  });

  it('does not depend on the order the log arrives in', () => {
    const expected = foldLogs(created, LOGS, params);

    const shuffles = [
      [...LOGS].reverse(),
      [LOGS[2]!, LOGS[0]!, LOGS[5]!, LOGS[1]!, LOGS[4]!, LOGS[3]!],
      [LOGS[5]!, LOGS[4]!, LOGS[1]!, LOGS[3]!, LOGS[2]!, LOGS[0]!],
    ];

    for (const shuffled of shuffles) {
      expect(foldLogs(created, shuffled, params)).toEqual(expected);
    }
  });

  /**
   * Two devices reviewing offline can produce the same `reviewed_at` down
   * to the millisecond. Without a total order the same log folds two ways
   * depending on which batch reached the server first.
   */
  it('breaks reviewed_at ties on id, whichever device syncs first', () => {
    const sameInstant = iso('2026-02-01T10:00:00Z');
    const phone: ReplayLog = {
      id: 'b0000000-0000-4000-8000-000000000001',
      rating: 1,
      reviewedAt: sameInstant,
    };
    const laptop: ReplayLog = {
      id: 'b0000000-0000-4000-8000-000000000002',
      rating: 4,
      reviewedAt: sameInstant,
    };

    const phoneFirst = foldLogs(created, [...LOGS, phone, laptop], params);
    const laptopFirst = foldLogs(created, [...LOGS, laptop, phone], params);
    expect(laptopFirst).toEqual(phoneFirst);
  });

  it('replays each card independently of the others', () => {
    const other: ReplayLog[] = [
      { id: 'c0000000-0000-4000-8000-000000000001', rating: 1, reviewedAt: iso('2026-01-02T09:00:00Z') },
    ];
    const alone = foldLogs(created, LOGS, params);
    // Interleaving a second card's log must not reach this fold — the caller
    // groups by card_id, so the guarantee is that nothing else is consulted.
    expect(foldLogs(created, LOGS, params)).toEqual(alone);
    expect(foldLogs(created, other, params)).not.toEqual(alone);
  });

  it('reschedules the whole collection when a parameter changes', () => {
    const strict = foldLogs(created, LOGS, schedulerParams(0.97));
    const relaxed = foldLogs(created, LOGS, schedulerParams(0.8));
    expect(strict.due.getTime()).toBeLessThan(relaxed.due.getTime());
  });
});

describe('sortLogs', () => {
  it('orders by reviewed_at, then id', () => {
    const t = iso('2026-03-01T00:00:00Z');
    const later = iso('2026-03-02T00:00:00Z');
    const sorted = sortLogs([
      { id: 'z', rating: 3, reviewedAt: later },
      { id: 'b', rating: 3, reviewedAt: t },
      { id: 'a', rating: 3, reviewedAt: t },
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['a', 'b', 'z']);
  });

  it('leaves the input array untouched', () => {
    const input: ReplayLog[] = [...LOGS].reverse();
    const snapshot = input.map((l) => l.id);
    sortLogs(input);
    expect(input.map((l) => l.id)).toEqual(snapshot);
  });
});
