import { acknowledgeLeech } from '@/lib/actions/leech';
import { undoReview } from '@/lib/actions/review';
import { enqueue, flush, noteConfusion, pending, pendingCount, takeBack } from '@/lib/client/outbox';
import type { Recorder } from '@/lib/client/recorder';

/**
 * The reviewer proper: every rating reaches `review_logs` through the outbox,
 * online or not.
 *
 * Nothing but wiring — the behaviour is all in `lib/client/outbox.ts` and the
 * two server actions. It is a separate module from the interface it
 * implements only because importing a server action drags the auth stack in
 * with it, and the inert recorder next door has to stay testable.
 */
export const recordingRecorder: Recorder = {
  enqueue,
  takeBack,
  undoOnServer: undoReview,
  pendingEntries: pending,
  pendingCount,
  flush,
  noteConfusion,
  acknowledgeLeech,
};
