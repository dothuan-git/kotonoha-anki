'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireSession, signOut } from '@/lib/auth';
import { db } from '@/lib/db';
import { settings, type Settings } from '@/lib/db/schema';

const SINGLETON_ID = 1;

const schema = z.object({
  newPerDay: z.number().int().min(0).max(100),
  reviewsPerDay: z.number().int().min(0).max(1000),
  requestRetention: z.number().min(0.7).max(0.99),
});

/** Reads the single settings row, creating it with §4's defaults on first run. */
export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SINGLETON_ID)).limit(1);
  if (row) return row;

  const [created] = await db
    .insert(settings)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  // Another request created it between the select and the insert.
  const [existing] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, SINGLETON_ID))
    .limit(1);
  if (!existing) throw new Error('Could not initialise settings');
  return existing;
}

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
