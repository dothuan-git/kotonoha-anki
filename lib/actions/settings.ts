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
  newPerDay: z.number().int().min(0).max(100),
  reviewsPerDay: z.number().int().min(0).max(1000),
  requestRetention: z.number().min(0.7).max(0.99),
  unlimitedPerDay: z.boolean(),
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
  return { ok: true as const };
}

export async function signOutAction() {
  await signOut({ redirectTo: '/signin' });
}
