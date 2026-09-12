'use server';

import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import { acknowledgeLeech as ackLeech } from '@/lib/db/leech';

import type { ActionResult } from '@/lib/actions/words';

/**
 * §4's leech prompt, dismissed.
 *
 * A server action rather than a sync payload, because unlike a rating it is
 * not something that happens on a schedule: it happens when the user reads the
 * prompt and decides they are done with it. Offline the dismissal is local
 * only and the card is flagged again next session, which is the honest
 * outcome — §4 asks for the prompt once, and once is a thing the server knows.
 */
export async function acknowledgeLeech(
  cardId: string,
): Promise<ActionResult<{ deactivatedProduction: boolean }>> {
  try {
    await requireSession();
  } catch {
    return { ok: false, error: 'Chưa đăng nhập' };
  }

  if (!z.string().uuid().safeParse(cardId).success) {
    return { ok: false, error: 'Không tìm thấy thẻ' };
  }

  try {
    const result = await ackLeech(cardId);
    if (!result) return { ok: false, error: 'Không tìm thấy thẻ' };
    return { ok: true, data: result };
  } catch (error) {
    console.error('[acknowledgeLeech] failed', error);
    return { ok: false, error: 'Không ghi được ghi chú thẻ khó' };
  }
}
