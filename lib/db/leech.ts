import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { cards } from '@/lib/db/schema';

/**
 * The leech rule, the half that is a write.
 *
 * At six lapses on a card, the UI flags it once and prompts a rewrite of the
 * meaning or an added note. What is stored here is only the "once": the prompt
 * has been shown and answered, so it does not reappear on the next lapse, or
 * on the one after that.
 *
 * The threshold itself is read, never stored: `card_states.lapses` is folded
 * from the log like everything else.
 *
 * It used to do one thing more — deactivate the word's production card, so the
 * harder direction went quiet while recognition kept running. There is no
 * production card now: a word is one card asked from both sides, and taking
 * one side out of rotation would mean a flag on the card saying which, which
 * is a column and a migration. So a leech is a prompt to fix the word and
 * nothing else; the word itself is never auto-deleted or auto-suspended, which
 * was always true.
 */
export async function acknowledgeLeech(cardId: string): Promise<boolean> {
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return false;

  // `isNull` rather than a blind set: the flag records the first time the
  // prompt was answered, and a second dismissal — another tab, a replayed
  // click — must not move that date forward.
  await db
    .update(cards)
    .set({ leechAckedAt: new Date() })
    .where(and(eq(cards.id, cardId), isNull(cards.leechAckedAt)));

  return true;
}
