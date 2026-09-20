import type { ActionResult } from '@/lib/actions/words';
import type { PendingConfusion, PendingReview, SyncResult, UndoResult } from '@/lib/types';

/**
 * Everything the reviewer does that leaves the device.
 *
 * The screen runs in two modes and they differ almost entirely in *what they
 * write*, so rather than scattering `if (practice)` down a thousand-line
 * component, every outbound call goes through one of these. Review mode gets
 * the real one (`lib/client/recording.ts`); practice gets the no-ops below.
 *
 * That turns "practice must not touch the schedule" from a property you audit
 * by reading the whole screen into one you read off this file — and most of
 * the mode's behaviour then falls out rather than being spelled twice:
 *
 * - `enqueue` does nothing, so no rating reaches the outbox, `/api/sync`,
 *   `review_logs` or `card_states`. This is the mode's whole contract.
 * - `pendingCount` is 0, so the flush interval — gated on `pending > 0` —
 *   never starts, and `chooseSession` is never told to prefer a stored
 *   practice queue because the *reviewer's* outbox happens to be full.
 * - `takeBack` reports that the rating was still local, which it always is
 *   when there was never a rating. Undo therefore takes the cheap branch and
 *   never calls the server, and in-session undo keeps working unchanged.
 *
 * Note what is *not* here: `rateLocally`. Practice still schedules on the
 * device, because that is what decides whether a card comes back inside the
 * session — answer Quên in practice and the word returns, exactly as it would
 * in a review. It is only the writing down that stops.
 *
 * The interface and the inert implementation live apart from the live one so
 * they can be tested without pulling a server action — and therefore the auth
 * stack — into the test graph.
 */
export interface Recorder {
  /** Queue a rating for the server. */
  enqueue(entry: PendingReview, queuedAt: number): Promise<void>;
  /** Take a rating back before it was sent. True when nothing was ever written. */
  takeBack(logId: string): Promise<boolean>;
  /** Delete a rating the server already holds — the uncommon half of undo. */
  undoOnServer(logId: string): Promise<ActionResult<UndoResult>>;
  /** Ratings the server has not seen, by card. */
  pendingEntries(): Promise<readonly { cardId: string }[]>;
  pendingCount(): Promise<number>;
  flush(): Promise<SyncResult | null>;
  noteConfusion(entry: PendingConfusion): Promise<void>;
  /** Mark the leech prompt as shown. A server write; the log cannot say it. */
  acknowledgeLeech(cardId: string): Promise<ActionResult<null>>;
}

/**
 * Practice: nothing leaves the device.
 *
 * Every method is deliberately inert rather than merely unused. A future call
 * site that forgets the mode gets a no-op, not a schedule change.
 */
export const practiceRecorder: Recorder = {
  enqueue: async () => {},
  // Nothing was ever sent, so it can always be taken back for free.
  takeBack: async () => true,
  // Unreachable — `takeBack` above never returns false — but a rating that
  // does not exist cannot be deleted, and saying so beats writing.
  undoOnServer: async () => ({ ok: false, error: 'Không còn gì để hoàn tác' }),
  pendingEntries: async () => [],
  pendingCount: async () => 0,
  flush: async () => null,
  noteConfusion: async () => {},
  acknowledgeLeech: async () => ({ ok: false, error: 'Không còn gì để hoàn tác' }),
};
