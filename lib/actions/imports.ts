'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireSession } from '@/lib/auth';
import { deleteImportBatch as deleteBatch } from '@/lib/db/imports';
import type { ActionResult } from '@/lib/actions/words';

const idInput = z.string().uuid();

/**
 * Undoes one import: its words, and the batch row itself.
 *
 * The import screen asks first, because this is not a smaller version of
 * deleting the file — a word imported in March and reviewed since loses that
 * history along with it.
 */
export async function deleteImportBatch(id: string): Promise<ActionResult<{ deleted: number }>> {
  try {
    await requireSession();
  } catch {
    return { ok: false, error: 'Chưa đăng nhập' };
  }

  const parsed = idInput.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: 'Lần nhập không hợp lệ' };
  }

  let deleted: number;
  try {
    deleted = await deleteBatch(parsed.data);
  } catch (error) {
    console.error('[deleteImportBatch] failed', error);
    return { ok: false, error: 'Không xoá được lần nhập này' };
  }

  revalidatePath('/words');
  revalidatePath('/kanji');
  revalidatePath('/add/bulk');
  return { ok: true, data: { deleted } };
}
