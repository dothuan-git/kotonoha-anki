'use server';

import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import {
  ReviewError,
  undoReview as undoReviewLog,
  type ReviewFailure,
} from '@/lib/db/review';
import type { UndoResult } from '@/lib/types';

import type { ActionResult } from '@/lib/actions/words';

const MESSAGES: Record<ReviewFailure, string> = {
  'card-unavailable': 'Thẻ không còn trong phiên ôn tập',
  'card-missing': 'Không tìm thấy thẻ',
  'write-failed': 'Không ghi được kết quả ôn tập',
  'log-missing': 'Không còn gì để hoàn tác',
  'undo-expired': 'Đã quá thời gian hoàn tác',
  'undo-not-latest': 'Thẻ đã được chấm lại, không hoàn tác được nữa',
};

/**
 * Take back a rating that has already reached the server.
 *
 * The uncommon half of undo. The outbox holds a rating for the
 * length of the window, so the usual undo drops a local row that was never
 * sent and never comes here at all. What is left for this to handle is a
 * rating that got out early — flushed by another tab, or synced from another
 * device — and that is the case worth spending the one deletion `review_logs`
 * permits on.
 *
 * The window is enforced here against `reviewed_at`, not against the client's
 * countdown: the toast is a hint, and a stale tab must not be able to delete a
 * log row from an hour ago.
 *
 * Rating itself is no longer an action. It goes through the outbox and
 * `/api/sync` whether or not there is a connection — one path, so an offline
 * review and an online one cannot land on different schedules.
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
