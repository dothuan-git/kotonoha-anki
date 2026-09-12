import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Order is the display order in the add form's selector. */
export const POS_VALUES = [
  'Noun',
  'Verb 1',
  'Verb 2',
  'Verb 3',
  'I-adjective',
  'Na-adjective',
  'Adverb',
  'Particle',
  'Conjunction',
  'Counter',
  'Expression',
] as const;

export const TRANSITIVITY_VALUES = ['transitive', 'intransitive'] as const;
export const JLPT_VALUES = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export const CARD_TYPE_VALUES = ['recognition', 'production', 'cloze'] as const;
export const SENTENCE_SOURCE_VALUES = ['ai', 'manual'] as const;

export const posEnum = pgEnum('pos', POS_VALUES);
export const transitivityEnum = pgEnum('transitivity', TRANSITIVITY_VALUES);
export const jlptEnum = pgEnum('jlpt', JLPT_VALUES);
export const cardTypeEnum = pgEnum('card_type', CARD_TYPE_VALUES);
export const sentenceSourceEnum = pgEnum('sentence_source', SENTENCE_SOURCE_VALUES);

export const words = pgTable(
  'words',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    headword: text('headword').notNull(),
    reading: text('reading').notNull(),
    meaning: text('meaning').notNull(),
    pos: posEnum('pos').notNull(),
    transitivity: transitivityEnum('transitivity'),
    jlpt: jlptEnum('jlpt'),
    note: text('note'),
    suspended: boolean('suspended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same headword can legitimately recur with a different reading
    // (開ける/あける vs 開ける/ひらける), so the identity is the pair.
    uniqueIndex('words_headword_reading_idx').on(t.headword, t.reading),
  ],
);

export const kanji = pgTable('kanji', {
  char: text('char').primaryKey(),
  /** Unihan kVietnamese, stored lowercase as the source gives it. */
  hanViet: text('han_viet').array().notNull().default([]),
  /** Not part of the core word model — the /kanji screen needs a gloss and a level. Hand-filled. */
  meaningVi: text('meaning_vi'),
  jlpt: jlptEnum('jlpt'),
});

export const wordKanji = pgTable(
  'word_kanji',
  {
    wordId: uuid('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    kanjiChar: text('kanji_char')
      .notNull()
      .references(() => kanji.char, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.wordId, t.kanjiChar, t.position] }),
    index('word_kanji_char_idx').on(t.kanjiChar),
  ],
);

export const sentences = pgTable(
  'sentences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wordId: uuid('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    jp: text('jp').notNull(),
    /** Ruby format: 窓[まど]を開[あ]けてください。 */
    jpRuby: text('jp_ruby').notNull(),
    vi: text('vi').notNull(),
    source: sentenceSourceEnum('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sentences_word_idx').on(t.wordId)],
);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wordId: uuid('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    cardType: cardTypeEnum('card_type').notNull(),
    active: boolean('active').notNull().default(true),
    /**
     * The leech flag, acknowledged. Not derived: `card_states.lapses` says
     * when a card *is* a leech, and the log says it the same way a year from
     * now — what the log cannot say is whether the prompt has already been
     * put in front of the user. The prompt shows once, so the once is stored.
     */
    leechAckedAt: timestamp('leech_acked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('cards_word_type_idx').on(t.wordId, t.cardType)],
);

/**
 * DERIVED. Never the source of truth; always reproducible by folding
 * review_logs for the card through the FSRS scheduler. Stored for query speed.
 */
export const cardStates = pgTable(
  'card_states',
  {
    cardId: uuid('card_id')
      .primaryKey()
      .references(() => cards.id, { onDelete: 'cascade' }),
    due: timestamp('due', { withTimezone: true }).notNull(),
    stability: real('stability'),
    difficulty: real('difficulty'),
    /** ts-fsrs State enum. 0 = New. */
    state: integer('state').notNull(),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReview: timestamp('last_review', { withTimezone: true }),
  },
  (t) => [index('card_states_due_idx').on(t.due)],
);

/**
 * APPEND ONLY. Never updated. The single permitted deletion is the undo
 * window: hard-delete the just-written row by id, then recompute.
 * `id` is client-generated so the offline outbox is idempotent on replay.
 */
export const reviewLogs = pgTable(
  'review_logs',
  {
    id: uuid('id').primaryKey(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** 1..4 = Again|Hard|Good|Easy */
    rating: integer('rating').notNull(),
    /** State *before* the review. */
    state: integer('state').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('review_logs_card_reviewed_idx').on(t.cardId, t.reviewedAt)],
);

/**
 * Confusion pairs — APPEND ONLY, like `review_logs` and for the same
 * reason: it is an observation of something that happened, not a tally that
 * gets edited. The counts on /stats are a fold over these rows.
 *
 * One row per wrong answer, typed from the meaning, that turned out to name
 * another word in the collection. `id` is generated on the device so the
 * offline outbox can replay a batch twice with no effect, as a review does.
 *
 * What was typed is deliberately not stored. A confusion is between two words
 * the user owns; a wrong answer that resolves to nothing is just a wrong
 * answer, and `review_logs` already recorded it.
 */
export const confusions = pgTable(
  'confusions',
  {
    id: uuid('id').primaryKey(),
    /** The word the card was asking for. */
    wordId: uuid('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    /** The word that was typed instead. */
    typedWordId: uuid('typed_word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('confusions_word_idx').on(t.wordId),
    index('confusions_observed_idx').on(t.observedAt),
  ],
);

export const dictCache = pgTable('dict_cache', {
  /** The normalised lookup query, not necessarily a saved headword. */
  headword: text('headword').primaryKey(),
  payload: jsonb('payload').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Single row, id = 1. Daily caps and app preferences. */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  newPerDay: integer('new_per_day').notNull().default(12),
  reviewsPerDay: integer('reviews_per_day').notNull().default(100),
  requestRetention: real('request_retention').notNull().default(0.9),
  theme: text('theme').notNull().default('light'),
});

export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;
export type Kanji = typeof kanji.$inferSelect;
export type Sentence = typeof sentences.$inferSelect;
export type NewSentence = typeof sentences.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type CardState = typeof cardStates.$inferSelect;
export type ReviewLog = typeof reviewLogs.$inferSelect;
export type Confusion = typeof confusions.$inferSelect;
export type Settings = typeof settings.$inferSelect;
