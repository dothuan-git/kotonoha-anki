import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { PriorGrade } from '@/lib/fsrs/pair';
import type { MissedWord } from '@/lib/recap';
import type { PendingConfusion, PendingReview, ReviewItem, SessionView } from '@/lib/types';

/**
 * The offline local store. Three things live here and nothing else.
 *
 * `outbox` is the one that matters. It holds ratings that have happened but
 * have not reached the server, and it is the reason a review taken in a tunnel
 * is not lost when the tab is closed before the signal comes back. Everything
 * about it is designed around that: the key is `review_logs.id`, generated at
 * the moment of the rating, so replaying the same entry twice is a no-op on
 * the server.
 *
 * `session` is a convenience — the day's queue, so the reviewer opens offline
 * instead of showing an error. Losing it costs a reload, not a review.
 *
 * `confusions` takes the same route as the outbox for the same reason — a
 * wrong answer typed in a tunnel is still worth knowing about — but it is
 * kept in its own store because losing one costs a note, and losing a rating
 * costs a review. They must never be able to hold each other up.
 */
interface KotonohaDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { 'by-reviewed-at': string };
  };
  session: {
    key: string;
    value: StoredSession;
  };
  confusions: {
    key: string;
    value: PendingConfusion;
  };
}

/**
 * A pending rating, plus when it was queued.
 *
 * `queuedAt` is the device's monotonic-enough wall clock and is used for one
 * thing only: holding an entry back until the undo window has passed, so the
 * common undo never has to delete a row from an append-only table. It is
 * never sent — `reviewedAt` is what the server schedules from.
 */
export interface OutboxEntry extends PendingReview {
  queuedAt: number;
}

export interface StoredSession {
  /**
   * `startOfStudyDay` for the day this queue was dealt on.
   *
   * A staleness guard, not a boundary any field is scoped to any more —
   * everything in this record now belongs to the session.
   */
  dayStart: string;
  savedAt: number;
  /** The live session: what is left to review, and the session held behind it. */
  session: SessionView;
  /**
   * What each word has been graded so far this session, by card.
   *
   * Here rather than in memory because a word is asked twice and graded once,
   * and the second face has to know what the first one wrote. Reload between
   * the two — a killed tab, a backgrounded phone — and without this the second
   * face would write a review of its own instead of revising the one standing,
   * which is the one thing the pair rule exists to prevent.
   */
  graded: Record<string, GradedCard>;
  /**
   * The words graded Quên or Khó in *this* session.
   *
   * Scoped like `graded` above, and reset with it whenever a new session is
   * dealt. Here rather than in memory for the same reason: the reviewer
   * derives the recap from what it has answered since it mounted, so without
   * this a reload mid-session would empty it.
   *
   * Optional because a record written before the recap existed has no such
   * field, and this store is deliberately never migrated.
   */
  missed?: MissedWord[];
}

export interface GradedCard extends PriorGrade {
  /** The showing as it stood *before* that grade — what a revision is applied to. */
  item: ReviewItem;
}

const DB_NAME = 'kotonoha';
/**
 * 2 added `confusions`. 3, 4 and 5 all dropped whatever was in `session`,
 * which is the one store that may be thrown away: a stored queue from before
 * a word was asked from both sides has no `face` on its items, one from
 * before the per-session change carries daily caps and no `next`, and one
 * written by a half-finished build can be anything at all. Losing it costs a
 * reload. The outbox is never touched by an upgrade — losing one of those
 * costs a review.
 */
const DB_VERSION = 5;

/** The only session row. One person, one device-local queue at a time. */
export const SESSION_KEY = 'current';

let handle: Promise<IDBPDatabase<KotonohaDB>> | null = null;

/**
 * Returns null where IndexedDB is not usable rather than throwing: the server
 * render has no `indexedDB`, and a private-mode browser can refuse to open
 * one. Neither should take the reviewer down — the session still works, it
 * just works online only, and every caller here treats null as "no local
 * store" and carries on.
 */
export function openLocalDb(): Promise<IDBPDatabase<KotonohaDB>> | null {
  if (typeof indexedDB === 'undefined') return null;

  handle ??= openDB<KotonohaDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('by-reviewed-at', 'reviewedAt');
        db.createObjectStore('session');
      }
      if (oldVersion < 2) {
        db.createObjectStore('confusions', { keyPath: 'id' });
      }
      if (oldVersion > 0 && oldVersion < 5) {
        db.deleteObjectStore('session');
        db.createObjectStore('session');
      }
    },
    // Another tab opened a newer version. Close so it is not blocked; this
    // tab falls back to online-only until it is reloaded.
    blocking() {
      void handle?.then((db) => db.close());
      handle = null;
    },
  }).catch((error) => {
    console.error('[localDb] could not open', error);
    handle = null;
    throw error;
  });

  return handle;
}
