import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { cards } from '@/lib/db/schema';

/**
 * The leech rule, the half that is a write.
 *
 * At six lapses on a card, the UI flags it once and prompts a rewrite of the
 * meaning or an added note; the production card then goes `active = false`
 * while recognition keeps running. The word itself is never auto-deleted or
 * auto-suspended.
 *
 * The threshold itself is read, never stored: `card_states.lapses` is folded
 * from the log like everything else. What is stored is the "once" — the
 * prompt has been shown and answered, so it does not reappear on the next
 * lapse, or on the one after that.
 *
 * Deactivating the production card is the *consequence* of the prompt, not of
 * the sixth lapse: the rewrite comes first, and a card taken out of rotation
 * before you have had a chance to fix its meaning is a card you never fixed.
 * So both writes happen here, when the prompt is dismissed, and neither
 * happens on its own.
 */
export interface LeechAcknowledgement {
  /** The word whose production card was taken out of rotation, if there was one. */
  deactivatedProduction: boolean;
}

export async function acknowledgeLeech(cardId: string): Promise<LeechAcknowledgement | null> {
  const [card] = await db
    .select({ id: cards.id, wordId: cards.wordId })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return null;

  // `isNull` rather than a blind set: the flag records the first time the
  // prompt was answered, and a second dismissal — another tab, a replayed
  // click — must not move that date forward.
  await db
    .update(cards)
    .set({ leechAckedAt: new Date() })
    .where(and(eq(cards.id, cardId), isNull(cards.leechAckedAt)));

  // Whichever card leeched, it is the production card that goes quiet and
  // recognition that keeps running. The word itself is never suspended
  // and never deleted — that stays a decision the user makes on /words.
  const deactivated = await db
    .update(cards)
    .set({ active: false })
    .where(
      and(
        eq(cards.wordId, card.wordId),
        eq(cards.cardType, 'production'),
        eq(cards.active, true),
      ),
    )
    .returning({ id: cards.id });

  return { deactivatedProduction: deactivated.length > 0 };
}
