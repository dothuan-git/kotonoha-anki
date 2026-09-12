import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { cardStates, cards, kanji, sentences, wordKanji, words } from '@/lib/db/schema';
import { extractKanji } from '@/lib/dict/furigana';
import type { Jlpt, Pos, Transitivity } from '@/lib/types';

/** Everything it takes to create a word, already validated by the caller. */
export interface WordInsert {
  headword: string;
  reading: string;
  meaning: string;
  pos: Pos;
  transitivity: Transitivity;
  jlpt: Jlpt | null;
  note: string | null;
  /** Hán Việt typed by hand, for the Unihan gaps §9 warns about. */
  hanViet: Record<string, string[]>;
  sentence: { jp: string; jpRuby: string; vi: string; source: 'ai' | 'manual' } | null;
  /** Overridable so a seed can backdate a word. Defaults to now. */
  createdAt?: Date;
}

/**
 * Writes a word, its kanji links, an optional first sentence, and its
 * `recognition` card (§4 — a new word gets that card only; `production` is
 * unlocked at stability >= 21, `cloze` is opt-in).
 *
 * Lives here rather than inside the server action so that a seed script
 * creates rows through exactly this path. The subtle part is not the insert —
 * it is that the word and its card state share one `createdAt`, because
 * `recomputeCardState` folds an empty log to `createEmptyCard(word.created_at)`
 * and a second timestamp would make every seeded row drift on the first
 * `npm run recompute`.
 *
 * The neon-http driver has no interactive transactions, so ids are generated
 * here and the whole insert goes through `db.batch`, which Neon applies as a
 * single transaction. Order matters: kanji rows must exist before word_kanji
 * can reference them.
 *
 * Throws on a duplicate (headword, reading); callers decide what that means.
 */
export async function insertWord(data: WordInsert): Promise<string> {
  const wordId = randomUUID();
  const cardId = randomUUID();
  const chars = extractKanji(data.headword);
  const createdAt = data.createdAt ?? new Date();

  type Statement = Parameters<typeof db.batch>[0][number];
  const batch: Statement[] = [
    db.insert(words).values({
      id: wordId,
      createdAt,
      headword: data.headword,
      reading: data.reading,
      meaning: data.meaning,
      pos: data.pos,
      transitivity: data.transitivity,
      jlpt: data.jlpt,
      note: data.note,
    }),
  ];

  // Ensure a kanji row exists for every character before linking to it. The
  // Unihan seed usually got there first; this covers gaps and hand-typed
  // readings without a second round trip.
  for (const char of [...new Set(chars)]) {
    const hanViet = normaliseHanViet(data.hanViet[char]);
    batch.push(
      hanViet.length > 0
        ? db
            .insert(kanji)
            .values({ char, hanViet })
            .onConflictDoUpdate({ target: kanji.char, set: { hanViet } })
        : db.insert(kanji).values({ char, hanViet: [] }).onConflictDoNothing(),
    );
  }

  chars.forEach((char, position) => {
    batch.push(db.insert(wordKanji).values({ wordId, kanjiChar: char, position }));
  });

  if (data.sentence) {
    batch.push(
      db.insert(sentences).values({
        wordId,
        jp: data.sentence.jp,
        jpRuby: data.sentence.jpRuby,
        vi: data.sentence.vi,
        source: data.sentence.source,
        createdAt,
      }),
    );
  }

  batch.push(
    db.insert(cards).values({ id: cardId, wordId, cardType: 'recognition', active: true }),
    // State 0 is ts-fsrs `State.New`. Due at creation so the card enters the
    // first session; the row is still a projection — an empty log folds to
    // exactly this, which is what lets `npm run recompute` reproduce it.
    db.insert(cardStates).values({ cardId, due: createdAt, state: 0, reps: 0, lapses: 0 }),
  );

  await db.batch(batch as [Statement, ...Statement[]]);
  return wordId;
}

/** Stored lowercase to match Unihan; display uppercases via formatHanViet. */
export function normaliseHanViet(input: string[] | undefined): string[] {
  if (!input) return [];
  return [
    ...new Set(
      input
        .flatMap((s) => s.split(/[\s,/·]+/))
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
