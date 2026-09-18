'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireSession, signOut } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSettings } from '@/lib/db/queries';
import { settings } from '@/lib/db/schema';

const SINGLETON_ID = 1;

const schema = z.object({
  /**
   * Floored at five rather than zero. Below five the new-word reserve rounds
   * to nothing and new words would silently stop appearing; a session of zero
   * would deal nothing at all while the finish screen kept promising more.
   */
  cardsPerSession: z.number().int().min(5).max(500),
  requestRetention: z.number().min(0.7).max(0.99),
});

export async function saveSettings(input: z.input<typeof schema>) {
  await requireSession();

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: 'Giá trị không hợp lệ' };
  }

  await getSettings();
  await db.update(settings).set(parsed.data).where(eq(settings.id, SINGLETON_ID));

  revalidatePath('/settings');
  // The session size decides both the next queue and the nav badge, and the
  // Router Cache would happily serve a stale `/` for half a minute otherwise.
  revalidatePath('/');
  return { ok: true as const };
}

export async function signOutAction() {
  await signOut({ redirectTo: '/signin' });
}
