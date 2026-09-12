import { aliasedTable, count, desc, eq, inArray, max, sql } from 'drizzle-orm';

import { resolveConfusion, type ConfusionPair, type WordIdentity } from '@/lib/confusion';
import { db } from '@/lib/db';
import { cards, confusions, words } from '@/lib/db/schema';
import type { PendingConfusion } from '@/lib/types';

/**
 * §13's confusion pairs — the half that touches the database.
 *
 * Recording is append-only, like `review_logs` and for the same reason: these
 * are observations, and the counts on /stats are a fold over them. The id is
 * generated on the device, so a batch replayed twice writes once.
 */

/** How many attempts one sync may carry. Bounded for the same reason the review batch is. */
export const MAX_CONFUSION_BATCH = 200;

/**
 * Resolves a batch of wrong answers against the collection and stores the ones
 * that named another word.
 *
 * The resolution happens here rather than on the device because the device
 * holds the day's queue, not the collection — it cannot know that あける is
 * also a word you own. The text itself is thrown away once resolved: a
 * confusion is a pair of words, and the miss is already in `review_logs`.
 *
 * Returns how many rows were kept, which is usually fewer than were sent.
 */
export async function recordConfusions(batch: readonly PendingConfusion[]): Promise<number> {
  if (batch.length === 0) return 0;

  const cardIds = [...new Set(batch.map((entry) => entry.cardId))];
  const owners = await db
    .select({ cardId: cards.id, wordId: cards.wordId })
    .from(cards)
    .where(inArray(cards.id, cardIds));
  const wordByCard = new Map(owners.map((row) => [row.cardId, row.wordId]));
  if (wordByCard.size === 0) return 0;

  // The whole collection, three columns of it. §1 is one person's vocabulary,
  // so this is thousands of rows at the outside, and it is read only when a
  // sync actually carries a wrong answer.
  const collection: WordIdentity[] = await db
    .select({ id: words.id, headword: words.headword, reading: words.reading })
    .from(words);

  const rows = batch.flatMap((entry) => {
    const wordId = wordByCard.get(entry.cardId);
    if (!wordId) return [];
    const typedWordId = resolveConfusion(entry.typed, wordId, collection);
    if (!typedWordId) return [];
    return [{ id: entry.id, wordId, typedWordId, observedAt: new Date(entry.observedAt) }];
  });

  if (rows.length === 0) return 0;

  try {
    await db.insert(confusions).values(rows).onConflictDoNothing({ target: confusions.id });
  } catch (error) {
    // A lost confusion is a lost note about a wrong answer, never the wrong
    // answer itself — that went through `applyReview` and is already logged.
    console.error('[recordConfusions] failed', error);
    return 0;
  }
  return rows.length;
}

/**
 * The pairs, most-confused first — a fold over the event rows, never a stored
 * tally.
 *
 * Directional on purpose: "asked for 開く, typed 開ける" and its mirror are two
 * different mistakes, and collapsing them would hide which direction is the
 * one that keeps failing.
 */
export async function listConfusions(limit = 12): Promise<ConfusionPair[]> {
  const asked = aliasedTable(words, 'asked');
  const typed = aliasedTable(words, 'typed');

  const rows = await db
    .select({
      wordId: asked.id,
      headword: asked.headword,
      reading: asked.reading,
      meaning: asked.meaning,
      typedId: typed.id,
      typedHeadword: typed.headword,
      typedReading: typed.reading,
      typedMeaning: typed.meaning,
      times: count(),
      lastAt: max(confusions.observedAt),
    })
    .from(confusions)
    .innerJoin(asked, eq(asked.id, confusions.wordId))
    .innerJoin(typed, eq(typed.id, confusions.typedWordId))
    .groupBy(
      asked.id,
      asked.headword,
      asked.reading,
      asked.meaning,
      typed.id,
      typed.headword,
      typed.reading,
      typed.meaning,
    )
    .orderBy(desc(count()), desc(max(confusions.observedAt)))
    .limit(limit);

  return rows.map((row) => ({
    word: {
      id: row.wordId,
      headword: row.headword,
      reading: row.reading,
      meaning: row.meaning,
    },
    typed: {
      id: row.typedId,
      headword: row.typedHeadword,
      reading: row.typedReading,
      meaning: row.typedMeaning,
    },
    count: Number(row.times),
    lastAt: (row.lastAt ?? new Date()).toISOString(),
  }));
}

/** How many wrong answers have ever resolved to another word — the /stats caption. */
export async function countConfusions(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(confusions);
  return Number(row?.n ?? 0);
}
