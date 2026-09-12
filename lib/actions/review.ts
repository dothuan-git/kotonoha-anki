'use server';

import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import {
  ReviewError,
  applyReview,
  undoReview as undoReviewLog,
  type ReviewFailure,
} from '@/lib/db/review';
import type { RateResult, UndoResult } from '@/lib/types';

import type { ActionResult } from '@/lib/actions/words';

const rateInput = z.object({
  /**
   * Client-generated, and the primary key of `review_logs` (§3). A retried
   * submit lands on the same row instead of logging the review twice — the
   * property Phase 4's offline outbox is built on.
   */
  logId: z.string().uuid(),
  cardId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

const MESSAGES: Record<ReviewFailure, string> = {
  'card-unavailable': 'Thẻ không còn trong phiên ôn tập',
  'card-missing': 'Không tìm thấy thẻ',
  'write-failed': 'Không ghi được kết quả ôn tập',
  'log-missing': 'Không còn gì để hoàn tác',
  'undo-expired': 'Đã quá thời gian hoàn tác',
  'undo-not-latest': 'Thẻ đã được chấm lại, không hoàn tác được nữa',
};

/**
 * Rate the card in front of me.
 *
 * `reviewed_at` is the server's clock. Phase 4 introduces `/api/sync`, where a
 * genuinely offline review carries its own timestamp; until then a client
 * clock is just an unvalidated input that could reorder the log.
 *
 * No `revalidatePath`: the session queue lives on the client for the duration
 * of the session, and refreshing `/` mid-session would swap the queue out from
 * under it. `/` is force-dynamic, so the next visit is fresh anyway.
 */
export async function rateCard(
  input: z.input<typeof rateInput>,
): Promise<ActionResult<RateResult>> {
  try {
    await requireSession();
  } catch {
    return { ok: false, error: 'Chưa đăng nhập' };
  }

  const parsed = rateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Đánh giá không hợp lệ' };

  try {
    return { ok: true, data: await applyReview(parsed.data) };
  } catch (error) {
    if (error instanceof ReviewError) return { ok: false, error: MESSAGES[error.reason] };
    console.error('[rateCard] failed', error);
    return { ok: false, error: MESSAGES['write-failed'] };
  }
}

/**
 * Take back the rating I just gave (§5).
 *
 * The window is enforced on the server against `reviewed_at`, not on the
 * client's countdown: the toast is a hint, and a stale tab must not be able to
 * delete a log row from an hour ago.
 */
export async function undoReview(logId: string): Promise<ActionResult<UndoResult>> {
  try {
    await requireSession();
  } catch {
    return { ok: false, error: 'Chưa đăng nhập' };
  }

  if (!z.string().uuid().safeParse(logId).success) {
    return { ok: false, error: MESSAGES['log-missing'] };
  }

  try {
    return { ok: true, data: await undoReviewLog(logId) };
  } catch (error) {
    if (error instanceof ReviewError) return { ok: false, error: MESSAGES[error.reason] };
    console.error('[undoReview] failed', error);
    return { ok: false, error: MESSAGES['write-failed'] };
  }
}
