import { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES } from '@/lib/db/schema';
import { LEECH_LAPSES } from '@/lib/fsrs/params';

export type Pos = (typeof POS_VALUES)[number];
export type Jlpt = (typeof JLPT_VALUES)[number];
export type Transitivity = (typeof TRANSITIVITY_VALUES)[number] | null;

export { JLPT_VALUES, POS_VALUES, TRANSITIVITY_VALUES };

/** `Again|Hard|Good|Easy` = 1|2|3|4, labelled in Vietnamese. */
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
 * One row of /words. `pos` and `transitivity` are separate fields, the
 * `hanViet` display string is derived from structured `kanji`, and a word
 * can carry more than one example in `sentences`.
 *
 * Scheduling fields are deliberately absent: they are a projection over
 * review_logs, and live on `ReviewItem.state` where they are needed.
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

/**
 * One past bulk import, as /add/bulk lists it. `wordCount` is how many of its
 * words survive now, not how many the file held.
 */
export interface ImportBatchView {
  id: string;
  source: string;
  note: string | null;
  createdAt: string;
  wordCount: number;
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
  /** Headword furigana in ruby format, e.g. 勉強[べんきょう]. */
  headwordRuby: string | null;
  kanji: KanjiRef[];
}

export interface LookupResult {
  query: string;
  cached: boolean;
  candidates: LookupCandidate[];
}

/**
 * Renders `開 KHAI · 始 THỦY`, derived rather than stored. Unihan gives
 * lowercase readings; display uppercases.
 */
export function formatHanViet(refs: readonly KanjiRef[]): string {
  const parts = refs
    .filter((k) => k.hanViet.length > 0)
    .map((k) => `${k.char} ${k.hanViet.join('/').toUpperCase()}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * Vietnamese display labels for the stored (English) part-of-speech values.
 *
 * The database keeps the English enum — renaming it would need a migration,
 * and every dictionary mapping in `lib/dict/pos.ts` targets those labels. This
 * map is display only: nothing reads back from it.
 */
export const POS_LABELS: Record<Pos, string> = {
  Noun: 'Danh từ',
  'Verb 1': 'Động từ loại 1',
  'Verb 2': 'Động từ loại 2',
  'Verb 3': 'Động từ loại 3',
  'I-adjective': 'Tính từ い',
  'Na-adjective': 'Tính từ な',
  Adverb: 'Trạng từ',
  Particle: 'Trợ từ',
  Conjunction: 'Liên từ',
  Counter: 'Trợ số từ',
  Expression: 'Cụm diễn đạt',
};

/** Renders `Động từ loại 2 · tha động từ`. */
export function formatPos(pos: Pos, transitivity: Transitivity): string {
  const label = POS_LABELS[pos] ?? pos;
  if (!transitivity) return label;
  const vi = transitivity === 'transitive' ? 'tha động từ' : 'tự động từ';
  return `${label} · ${vi}`;
}

/** The four rating buttons, pre-rendered server-side: `1` = Quên … `4` = Dễ. */
export type RatingPreviews = Record<1 | 2 | 3 | 4, string>;

/**
 * A folded card as the client sees it. Derived, never stored as-is.
 *
 * Wider than the `card_states` row on purpose. The last three fields are not
 * stored anywhere: they come off the fold that produced this view, and the
 * scheduler runs client-side during a session, where a card has to be
 * stepped forward with no server and no log in reach. `learningSteps` in
 * particular is what lets a card mid-way through `['1m', '10m']` keep its
 * place in airplane mode.
 *
 * `lib/fsrs/state.ts` converts both ways.
 */
export interface CardStateView {
  due: string;
  stability: number | null;
  difficulty: number | null;
  state: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
}

/**
 * Which way round a word is being asked.
 *
 * A word is one card with one schedule, shown twice in a session: `word` puts
 * the Japanese on the prompt side, `meaning` puts the Vietnamese there and
 * asks you to come back the other way. Both showings answer for the same
 * card, which is why the pair is graded once — see `RateResult`.
 */
export type Face = 'word' | 'meaning';

/** How many times a typed answer may be wrong before the card gives it up. */
export const MAX_ANSWER_ATTEMPTS = 3;

export interface ReviewItem {
  cardId: string;
  /**
   * Which side is being asked. The other face of the same card is elsewhere in
   * the same session, carrying the same `cardId` and the same `state`.
   */
  face: Face;
  /** First ever showing — drives the "từ mới" badge and the new-card cap. */
  isNew: boolean;
  word: WordView;
  state: CardStateView;
  previews: RatingPreviews;
  /**
   * The leech prompt has already been shown for this card. The count itself
   * is `state.lapses`, folded from the log like everything else; this is the
   * one bit the log cannot supply, which is why it rides along.
   */
  leechAcked: boolean;
  /**
   * Put back into the queue by a learning step rather than dealt by the day.
   *
   * Set on the device and never by the server, which deals each card exactly
   * twice and knows nothing about the steps walked after that. It is on the
   * wire shape regardless because the session is stored and resumed, and a
   * repeat that came back from storage without it would be read as the word's
   * other face — see `revises()`.
   */
  repeat?: boolean;
}

/** Six lapses, and the prompt has not been shown yet. */
export function isLeech(item: {
  state: { lapses: number };
  leechAcked: boolean;
}): boolean {
  return !item.leechAcked && item.state.lapses >= LEECH_LAPSES;
}

/** Work that exists now but did not fit the session in hand. */
export interface RemainingWork {
  newCards: number;
  reviewCards: number;
}

export interface SessionView {
  now: string;
  items: ReviewItem[];
  /**
   * The session after this one, dealt ahead of being asked for.
   *
   * The client cannot build a queue — it holds no words, sentences or logs for
   * cards it was never handed — so without this, finishing a session offline
   * would end the day. Empty once nothing more is waiting.
   */
  next: ReviewItem[];
  /** `settings.cardsPerSession`, carried for the finish screen's copy. */
  cardsPerSession: number;
  /**
   * The only user-movable scheduler knob, carried so the client can build
   * the same `FSRSParameters` the server would — the scheduler runs in the
   * browser during the session.
   */
  requestRetention: number;
  /**
   * Due and new cards that exist but did not fit this session — why the
   * session is the length it is.
   *
   * A lower bound. It is counted when the session is built, so it knows
   * nothing about reviews that fall due while you work, and nothing about the
   * learning cards the session makes for itself every time you answer Quên.
   * Fine for colouring the finish screen's copy; never gate the next session
   * on it.
   */
  remaining: RemainingWork;
  /** Earliest due date among active cards outside this session. */
  nextDue: string | null;
  totalCards: number;
}

/**
 * One rating applied — locally during the session, or on the server at sync.
 *
 * One per *word* per session, not one per showing. A word is asked twice and
 * graded once: the first face answered writes the review, and if its twin
 * comes back worse, that grade replaces it rather than adding a second review
 * the scheduler never expected. See `worseOf` and the pair rules in
 * `lib/fsrs/pair.ts`.
 */
export interface RateResult {
  cardId: string;
  state: CardStateView;
  previews: RatingPreviews;
  /** The card comes back inside this session (a learning step), rather than leaving it. */
  repeat: boolean;
  /**
   * This review took the card to six lapses and the prompt has not been
   * shown. Computed on the device as well as on the server: it needs nothing
   * but the card's own fold and the flag it arrived with, so the prompt
   * appears on the train too.
   */
  leech: boolean;
}

/**
 * One rating waiting in the outbox.
 *
 * `id` is `review_logs.id`, generated on the device, which is the whole
 * idempotency story: a batch can be POSTed twice, or by two devices, and the
 * primary key collapses the duplicates. `reviewedAt` is the device's true
 * clock at the moment of the rating, not the moment it reached the server —
 * a review taken on the train is scheduled from when it happened.
 */
export interface PendingReview {
  id: string;
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: string;
}

/**
 * One confusion waiting in the outbox.
 *
 * Rides the same route as a rating and for the same reasons: a wrong answer
 * typed in a tunnel is still worth knowing about, and a client-generated `id`
 * makes the replay idempotent.
 *
 * `typed` is the raw attempt because only the server can resolve it — the
 * device holds the day's queue, not the collection. The server matches it
 * against every word, stores the pair of ids, and throws the text away.
 */
export interface PendingConfusion {
  id: string;
  cardId: string;
  typed: string;
  observedAt: string;
}

/**
 * What `/api/sync` hands back after replaying a batch. The client throws
 * its local scheduling away and takes this: the server always wins, because it
 * is the only party that folded the whole log.
 */
export interface SyncResult {
  /** Log ids the server now holds — safe to drop from the outbox. */
  applied: string[];
  /**
   * Log ids that will never be accepted (the card is gone, or suspended).
   * Also safe to drop: retrying them forever would wedge the outbox.
   */
  rejected: { id: string; reason: string }[];
  /** Authoritative state per affected card, after the replay. */
  states: Record<string, { state: CardStateView; previews: RatingPreviews }>;
  /**
   * Cards the replay left at six lapses with the prompt unshown. The
   * device works this out for itself during the session; this covers the card
   * whose sixth lapse was rated on another device.
   */
  leeches: string[];
}

/**
 * The undo window: ten seconds, and the only deletion `review_logs` ever
 * permits. Shared so the toast's countdown and the server's guard cannot
 * disagree about how long you have.
 */
export const UNDO_WINDOW_MS = 10_000;

/**
 * What `undoReview` hands back after deleting the log row and recomputing.
 * The same shape the client had before the rating, so the card can go back in
 * front of you with the state the log now implies rather than a cached guess.
 */
export interface UndoResult {
  cardId: string;
  state: CardStateView;
  previews: RatingPreviews;
}
