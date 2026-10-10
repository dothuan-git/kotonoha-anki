'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/words';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { getGrammar, insertGrammar, replaceGrammar } from '@/lib/db/grammar';
import { grammarPoints } from '@/lib/db/schema';
import { isUniqueViolation } from '@/lib/db/words';
import { grammarInput, type GrammarInput } from '@/lib/grammar';
import type { GrammarView } from '@/lib/types';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const DUPLICATE = 'Mẫu ngữ pháp này đã có trong sổ (cùng nghĩa)';

function revalidate() {
  revalidatePath('/grammar');
  revalidatePath('/grammar/list');
}

async function signedIn(): Promise<boolean> {
  try {
    await requireSession();
    return true;
  } catch {
    return false;
  }
}

/** Creates a grammar point, its sentences and its card. */
export async function createGrammar(input: GrammarInput): Promise<ActionResult<GrammarView>> {
  if (!(await signedIn())) return fail('Chưa đăng nhập');

  const parsed = grammarInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');

  try {
    const id = await insertGrammar(parsed.data);
    const view = await getGrammar(id);
    if (!view) return fail('Không lưu được mẫu ngữ pháp');
    revalidate();
    return { ok: true, data: view };
  } catch (error) {
    if (isUniqueViolation(error)) return fail(DUPLICATE);
    console.error('[createGrammar] failed', error);
    return fail('Không lưu được mẫu ngữ pháp');
  }
}

/** Edits a point and replaces its sentences. The card and its history stay. */
export async function updateGrammar(
  id: string,
  input: GrammarInput,
): Promise<ActionResult<GrammarView>> {
  if (!(await signedIn())) return fail('Chưa đăng nhập');
  if (!z.string().uuid().safeParse(id).success) return fail('Không tìm thấy mẫu ngữ pháp');

  const parsed = grammarInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');

  try {
    if (!(await replaceGrammar(id, parsed.data))) return fail('Không tìm thấy mẫu ngữ pháp');
    const view = await getGrammar(id);
    if (!view) return fail('Không tìm thấy mẫu ngữ pháp');
    revalidate();
    return { ok: true, data: view };
  } catch (error) {
    if (isUniqueViolation(error)) return fail(DUPLICATE);
    console.error('[updateGrammar] failed', error);
    return fail('Không cập nhật được mẫu ngữ pháp');
  }
}

/**
 * Deletes a point outright — sentences, card, state and review history go
 * with it by cascade. Never automatic, as for words.
 */
export async function deleteGrammar(id: string): Promise<ActionResult> {
  if (!(await signedIn())) return fail('Chưa đăng nhập');

  try {
    await db.delete(grammarPoints).where(eq(grammarPoints.id, id));
  } catch (error) {
    console.error('[deleteGrammar] failed', error);
    return fail('Không xoá được mẫu ngữ pháp');
  }
  revalidate();
  return { ok: true, data: undefined };
}

/** The manual suspend toggle. Never automatic. */
export async function setGrammarSuspended(id: string, suspended: boolean): Promise<ActionResult> {
  if (!(await signedIn())) return fail('Chưa đăng nhập');

  try {
    await db.update(grammarPoints).set({ suspended }).where(eq(grammarPoints.id, id));
  } catch (error) {
    console.error('[setGrammarSuspended] failed', error);
    return fail('Không cập nhật được mẫu ngữ pháp');
  }
  revalidate();
  return { ok: true, data: undefined };
}
