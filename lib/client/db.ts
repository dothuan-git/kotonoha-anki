import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { PendingConfusion, PendingReview, SessionView } from '@/lib/types';

/**
 * §8's local store. Three things live here and nothing else.
 *
 * `outbox` is the one that matters. It holds ratings that have happened but
 * have not reached the server, and it is the reason a review taken in a tunnel
 * is not lost when the tab is closed before the signal comes back. Everything
 * about it is designed around that: the key is `review_logs.id`, generated at
 * the moment of the rating, so replaying the same entry twice is a no-op on
 * the server (§3).
 *
 * `session` is a convenience — the day's queue, so the reviewer opens offline
 * instead of showing an error. Losing it costs a reload, not a review.
 *
 * `confusions` is §13's, added in Phase 5. It takes the same route as the
 * outbox for the same reason — a wrong answer typed in a tunnel is still
 * worth knowing about — but it is kept in its own store because losing one
 * costs a note, and losing a rating costs a review. They must never be able to
 * hold each other up.
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
 * thing only: holding an entry back until §5's undo window has passed, so the
 * common undo never has to delete a row from an append-only table. It is
 * never sent — `reviewedAt` is what the server schedules from.
 */
export interface OutboxEntry extends PendingReview {
  queuedAt: number;
}

export interface StoredSession {
  /** `startOfStudyDay` for the day this queue belongs to (§4). */
  dayStart: string;
  savedAt: number;
  /** The live session: what is left to review, and the caps spent so far. */
  session: SessionView;
}

const DB_NAME = 'kotonoha';
/** 2 added `confusions` (§13). Upgrades are additive; nothing existing moves. */
const DB_VERSION = 2;

/** The only session row. One person, one device-local queue at a time (§1). */
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
