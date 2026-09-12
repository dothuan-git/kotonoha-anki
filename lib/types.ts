import { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES } from '@/lib/db/schema';

export type Pos = (typeof POS_VALUES)[number];
export type Jlpt = (typeof JLPT_VALUES)[number];
export type Transitivity = (typeof TRANSITIVITY_VALUES)[number] | null;

export { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES };

/** §6 ratings. `Again|Hard|Good|Easy` = 1|2|3|4, labelled in Vietnamese. */
export const RATING_LABELS = ['Quên', 'Khó', 'Được', 'Dễ'] as const;
export type RatingLabel = (typeof RATING_LABELS)[number];

export interface RubySegment {
  base: string;
  ruby?: string;
}

export interface SentenceView {
  id: string;
  jp: string;
  jpRuby: string;
  vi: string;
  source: 'ai' | 'manual' | null;
}

export interface KanjiRef {
  char: string;
  hanViet: string[];
}

/**
 * One row of /words. Replaces the prototype's flat `WordItem`: `partOfSpeech`
 * splits into `pos` + `transitivity`, the `hanViet` display string becomes
 * structured `kanji`, and the single inline example becomes `sentences`.
 *
 * Scheduling fields are deliberately absent: they are a projection over
 * review_logs (§5), and live on `ReviewItem.state` where they are needed.
 */
export interface WordView {
  id: string;
  headword: string;
  reading: string;
  meaning: string;
  pos: Pos;
  transitivity: Transitivity;
  jlpt: Jlpt | null;
  note: string | null;
  suspended: boolean;
  createdAt: string;
  kanji: KanjiRef[];
  sentences: SentenceView[];
}

export interface KanjiView {
  char: string;
  hanViet: string[];
  meaningVi: string | null;
  jlpt: Jlpt | null;
  wordCount: number;
}

/** What GET /api/lookup returns. Every field is a suggestion, not a commitment. */
export interface LookupCandidate {
  headword: string;
  reading: string;
  /** Jotoba's English glosses — a sanity check for the user, never saved. */
  glosses: string[];
  pos: Pos | null;
  transitivity: Transitivity;
  jlptHint: Jlpt | null;
  common: boolean;
  /** Headword furigana converted to §7 format, e.g. 勉強[べんきょう]. */
  headwordRuby: string | null;
  kanji: KanjiRef[];
}

export interface LookupResult {
  query: string;
  cached: boolean;
  candidates: LookupCandidate[];
}

/**
 * Renders `開 KHAI · 始 THỦY` — the prototype's `hanViet` string, derived
 * rather than stored. Unihan gives lowercase readings; display uppercases.
 */
export function formatHanViet(refs: readonly KanjiRef[]): string {
  const parts = refs
    .filter((k) => k.hanViet.length > 0)
    .map((k) => `${k.char} ${k.hanViet.join('/').toUpperCase()}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Renders `Verb 2 · tha động từ`, the prototype's `partOfSpeech` line. */
export function formatPos(pos: Pos, transitivity: Transitivity): string {
  if (!transitivity) return pos;
  const vi = transitivity === 'transitive' ? 'tha động từ' : 'tự động từ';
  return `${pos} · ${vi}`;
}

/** §4's four buttons, pre-rendered server-side: `1` = Quên … `4` = Dễ. */
export type RatingPreviews = Record<1 | 2 | 3 | 4, string>;

/** A `card_states` row as the client sees it. Derived — see §5. */
export interface CardStateView {
  due: string;
  stability: number | null;
  difficulty: number | null;
  state: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

export interface ReviewItem {
  cardId: string;
  cardType: 'recognition' | 'production' | 'cloze';
  /** First ever showing — drives the "từ mới" badge and the new-card cap. */
  isNew: boolean;
  word: WordView;
  state: CardStateView;
  previews: RatingPreviews;
}

/** Distinct cards studied since the study day began, split by §4's two caps. */
export interface DailyCounts {
  newCards: number;
  reviewCards: number;
}

export interface SessionView {
  now: string;
  items: ReviewItem[];
  counts: DailyCounts;
  limits: { newPerDay: number; reviewsPerDay: number };
  /** Cards that were due but did not fit today's caps — why the session is short. */
  heldBack: DailyCounts;
  /** Earliest due date among active cards outside this session. */
  nextDue: string | null;
  nextDayStart: string;
  totalCards: number;
}

/** What `rateCard` hands back: the authoritative state, never the client's guess. */
export interface RateResult {
  cardId: string;
  state: CardStateView;
  previews: RatingPreviews;
  /** The card comes back inside this session (a learning step), rather than leaving it. */
  repeat: boolean;
  counts: DailyCounts;
  /**
   * This review took the recognition card past §4's stability threshold and
   * created the word's production card. It joins a later session, never this
   * one — §4 forbids two cards from the same word in one session.
   */
  unlockedProduction: boolean;
}

/**
 * §5's undo window: ten seconds, and the only deletion `review_logs` ever
 * permits. Shared so the toast's countdown and the server's guard cannot
 * disagree about how long you have.
 */
export const UNDO_WINDOW_MS = 10_000;

/**
 * What `undoReview` hands back after deleting the log row and recomputing (§5).
 * The same shape the client had before the rating, so the card can go back in
 * front of you with the state the log now implies rather than a cached guess.
 */
export interface UndoResult {
  cardId: string;
  state: CardStateView;
  previews: RatingPreviews;
  counts: DailyCounts;
}
