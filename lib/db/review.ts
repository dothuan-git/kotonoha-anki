import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getSettings, hydrateWords } from '@/lib/db/queries';
import { cardStates, cards, reviewLogs, words } from '@/lib/db/schema';
import { startOfNextStudyDay, startOfStudyDay } from '@/lib/fsrs/day';
import { formatInterval } from '@/lib/fsrs/format';
import { LEARN_AHEAD_MINUTES, schedulerParams } from '@/lib/fsrs/params';
import { buildQueue, type QueueCandidate, type QueueEntry } from '@/lib/fsrs/queue';
import {
  State,
  applyRating,
  foldLogs,
  previewDueDates,
  type Card,
  type RatingValue,
  type ReplayLog,
} from '@/lib/fsrs/replay';
import { UNDO_WINDOW_MS } from '@/lib/types';
import type {
  CardStateView,
  DailyCounts,
  RateResult,
  RatingPreviews,
  ReviewItem,
  SessionView,
  UndoResult,
} from '@/lib/types';

/**
 * Everything here treats `card_states` as §5 describes it: a cache of a fold
 * over `review_logs`. It is written in exactly one place — `stateUpsert` — and
 * always from a freshly folded card. No stored state is ever mutated in place.
 */

type FsrsParams = ReturnType<typeof schedulerParams>;
type CardRow = { cardId: string; wordId: string; createdAt: Date };

/**
 * The two counters §4's caps are spent against, since the study day began.
 *
 * Counted per card rather than per log row, and each card counts once: a new
 * card walking its learning steps writes several rows the same day, and those
 * repeats must not also eat a review slot. A card counts as new if its first
 * showing today was its first showing ever.
 */
export async function getDailyCounts(now = new Date()): Promise<DailyCounts> {
  const rows = await db
    .select({
      cardId: reviewLogs.cardId,
      wasNew: sql<boolean>`bool_or(${reviewLogs.state} = 0)`,
    })
    .from(reviewLogs)
    .where(gte(reviewLogs.reviewedAt, startOfStudyDay(now)))
    .groupBy(reviewLogs.cardId);

  let newCards = 0;
  for (const row of rows) if (row.wasNew) newCards++;
  return { newCards, reviewCards: rows.length - newCards };
}

/**
 * The day's session (§4). The caps are applied once, here: there is no "study
 * more" escape hatch, so the queue the client receives is the whole day.
 */
export async function buildSession(now = new Date()): Promise<SessionView> {
  const [settings, counts] = await Promise.all([getSettings(), getDailyCounts(now)]);
  const params = schedulerParams(settings.requestRetention);

  const candidates = await db
    .select({
      cardId: cards.id,
      wordId: cards.wordId,
      cardType: cards.cardType,
      due: cardStates.due,
      state: cardStates.state,
      createdAt: words.createdAt,
    })
    .from(cards)
    .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.active, true), eq(words.suspended, false)));

  const dueReviews: QueueCandidate[] = [];
  const newCards: QueueCandidate[] = [];
  let nextDue: Date | null = null;

  // A card put back by a learning step is due in a minute or ten. Reaching that
  // far ahead lets a reload resume the session instead of announcing the day is
  // over while a card is eight minutes out. Only learning states sit this
  // close — anything in Review is a day away at least.
  const learnAhead = now.getTime() + LEARN_AHEAD_MINUTES * 60_000;

  for (const row of candidates) {
    const due = row.due.getTime();
    const inSession =
      due <= now.getTime() ||
      ((row.state === State.Learning || row.state === State.Relearning) && due <= learnAhead);

    if (row.state === State.New) {
      newCards.push({ cardId: row.cardId, wordId: row.wordId, order: row.createdAt.getTime() });
    } else if (inSession) {
      dueReviews.push({ cardId: row.cardId, wordId: row.wordId, order: due });
    } else if (!nextDue || row.due < nextDue) {
      nextDue = row.due;
    }
  }

  const reviewLimit = Math.max(0, settings.reviewsPerDay - counts.reviewCards);
  const newLimit = Math.max(0, settings.newPerDay - counts.newCards);
  const queue = buildQueue({ reviews: dueReviews, news: newCards, reviewLimit, newLimit });

  const meta = new Map(candidates.map((c) => [c.cardId, c]));
  const items = await hydrateQueue(queue, meta, params, now);

  return {
    now: now.toISOString(),
    items,
    counts,
    limits: { newPerDay: settings.newPerDay, reviewsPerDay: settings.reviewsPerDay },
    heldBack: {
      newCards: Math.max(0, newCards.length - newLimit),
      reviewCards: Math.max(0, dueReviews.length - reviewLimit),
    },
    nextDue: nextDue?.toISOString() ?? null,
    nextDayStart: startOfNextStudyDay(now).toISOString(),
    totalCards: candidates.length,
  };
}

/**
 * Turns queue entries into renderable items: one query for the logs, one for
 * the words, then a fold per card.
 *
 * The fold is also what produces ts-fsrs's `learning_steps`, which
 * `card_states` deliberately does not store — a stored step index would be a
 * second source of truth for something the log already determines.
 */
async function hydrateQueue(
  queue: readonly QueueEntry[],
  meta: Map<string, { cardType: ReviewItem['cardType']; createdAt: Date }>,
  params: FsrsParams,
  now: Date,
): Promise<ReviewItem[]> {
  if (queue.length === 0) return [];

  const cardIds = queue.map((q) => q.cardId);
  const wordIds = [...new Set(queue.map((q) => q.wordId))];

  const [logRows, wordRows] = await Promise.all([
    selectLogs(cardIds),
    db.select().from(words).where(inArray(words.id, wordIds)),
  ]);

  const logsByCard = groupLogs(logRows);
  const wordViews = new Map((await hydrateWords(wordRows)).map((w) => [w.id, w]));

  const items: ReviewItem[] = [];
  for (const entry of queue) {
    const card = meta.get(entry.cardId);
    const word = wordViews.get(entry.wordId);
    if (!card || !word) continue;

    const folded = foldLogs(card.createdAt, logsByCard.get(entry.cardId) ?? [], params);
    items.push({
      cardId: entry.cardId,
      cardType: card.cardType,
      isNew: entry.isNew,
      word,
      state: toStateView(folded),
      previews: toPreviews(folded, now, params),
    });
  }
  return items;
}

/** The folded card plus what it takes to apply the next rating to it. */
export async function loadFoldedCard(
  cardId: string,
): Promise<{ card: Card; params: FsrsParams; lastReviewedAt: Date | null } | null> {
  const [row] = await db
    .select({ cardId: cards.id, wordId: cards.wordId, createdAt: words.createdAt })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!row) return null;

  const settings = await getSettings();
  const params = schedulerParams(settings.requestRetention);
  const logs = await selectLogs([cardId]);

  const ordered = logs.map((l) => l.reviewedAt).sort((a, b) => a.getTime() - b.getTime());
  return {
    card: foldLogs(row.createdAt, logs, params),
    params,
    lastReviewedAt: ordered.at(-1) ?? null,
  };
}

export type ReviewFailure =
  | 'card-unavailable'
  | 'card-missing'
  | 'write-failed'
  | 'log-missing'
  | 'undo-expired'
  | 'undo-not-latest';

export class ReviewError extends Error {
  constructor(readonly reason: ReviewFailure) {
    super(reason);
  }
}

/**
 * One review: fold the log, apply the rating, append, store the projection.
 *
 * The scheduling lives here rather than in the server action so that Phase 4's
 * `/api/sync` replays an offline batch through exactly this path instead of a
 * parallel implementation that can drift from it.
 */
export async function applyReview(input: {
  /** `review_logs.id`, generated by the caller — the idempotency key (§3). */
  logId: string;
  cardId: string;
  rating: RatingValue;
  now?: Date;
}): Promise<RateResult> {
  const now = input.now ?? new Date();

  const [available] = await db
    .select({
      id: cards.id,
      wordId: cards.wordId,
      cardType: cards.cardType,
      wordCreatedAt: words.createdAt,
    })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.id, input.cardId), eq(cards.active, true), eq(words.suspended, false)))
    .limit(1);
  if (!available) throw new ReviewError('card-unavailable');

  const folded = await loadFoldedCard(input.cardId);
  if (!folded) throw new ReviewError('card-missing');

  // Already logged under this id — a retry, or a double submit. The fold
  // already contains it, so applying the rating again would count the review
  // twice. Hand back the state the log already implies.
  const [existing] = await db
    .select({ id: reviewLogs.id })
    .from(reviewLogs)
    .where(eq(reviewLogs.id, input.logId))
    .limit(1);
  if (existing) return await describe(input.cardId, folded.card, now, folded.params);

  // The fold is ordered by reviewed_at, so a clock that went backwards would
  // silently reorder history. Nudge past the last entry instead.
  const reviewedAt =
    folded.lastReviewedAt && folded.lastReviewedAt >= now
      ? new Date(folded.lastReviewedAt.getTime() + 1)
      : now;

  const next = applyRating(folded.card, input.rating, reviewedAt, folded.params);

  try {
    await db.batch([
      db
        .insert(reviewLogs)
        .values({
          id: input.logId,
          cardId: input.cardId,
          rating: input.rating,
          // The state *before* the review, which is what a replay needs.
          state: next.log.state,
          elapsedDays: next.log.elapsed_days,
          scheduledDays: next.log.scheduled_days,
          reviewedAt,
        })
        .onConflictDoNothing({ target: reviewLogs.id }),
      stateUpsert(input.cardId, next.card),
    ]);
  } catch (error) {
    console.error('[applyReview] failed', error);
    throw new ReviewError('write-failed');
  }

  // §4 — checked after every review, on the card that just moved.
  const unlockedProduction =
    available.cardType === 'recognition'
      ? await unlockProductionCard(available.wordId, available.wordCreatedAt, next.card)
      : false;

  return await describe(input.cardId, next.card, reviewedAt, folded.params, unlockedProduction);
}

async function describe(
  cardId: string,
  card: Card,
  now: Date,
  params: FsrsParams,
  unlockedProduction = false,
): Promise<RateResult> {
  return {
    cardId,
    state: toStateView(card),
    previews: toPreviews(card, now, params),
    repeat: staysInSession(card, now),
    counts: await getDailyCounts(now),
    unlockedProduction,
  };
}

/** §4: "created and activated automatically once the recognition card's stability >= 21". */
export const PRODUCTION_UNLOCK_STABILITY = 21;

/**
 * Creates the word's production card once its recognition card is solid enough.
 *
 * The new card's state row is `createEmptyCard(word.created_at)` — the same
 * seed every other fold uses (§5) — so `npm run recompute` reproduces it
 * exactly instead of moving it to whenever the rebuild happened to run. Being
 * due in the past is the point: it is a new card and belongs in the next
 * session, not this one (§4 allows only one card per word per session).
 *
 * A failure here is logged and swallowed. The review it followed is already
 * written, and losing an unlock costs nothing: the next review of the same
 * card runs this check again.
 */
async function unlockProductionCard(
  wordId: string,
  wordCreatedAt: Date,
  recognition: Card,
): Promise<boolean> {
  if (recognition.state === State.New) return false;
  if (!recognition.stability || recognition.stability < PRODUCTION_UNLOCK_STABILITY) return false;

  try {
    const [existing] = await db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.wordId, wordId), eq(cards.cardType, 'production')))
      .limit(1);
    if (existing) return false;

    const cardId = randomUUID();
    await db.batch([
      db
        .insert(cards)
        .values({ id: cardId, wordId, cardType: 'production', active: true })
        .onConflictDoNothing({ target: [cards.wordId, cards.cardType] }),
      db
        .insert(cardStates)
        .values({ cardId, due: wordCreatedAt, state: State.New, reps: 0, lapses: 0 })
        .onConflictDoNothing({ target: cardStates.cardId }),
    ]);
    return true;
  } catch (error) {
    console.error('[unlockProductionCard] failed', error);
    return false;
  }
}

/**
 * Takes back the review that was just written: delete that one row by id, then
 * rebuild the card from what remains (§5). Nothing is compensated or patched —
 * the projection simply folds a shorter log.
 *
 * Two guards, because a delete against an append-only table should be narrow:
 * the row has to be inside the window, and it has to be the card's most recent
 * review. Undoing into the middle of a history would rewrite everything after
 * it on the next fold.
 */
export async function undoReview(logId: string, now = new Date()): Promise<UndoResult> {
  const [log] = await db
    .select({ id: reviewLogs.id, cardId: reviewLogs.cardId, reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(eq(reviewLogs.id, logId))
    .limit(1);
  if (!log) throw new ReviewError('log-missing');

  if (now.getTime() - log.reviewedAt.getTime() > UNDO_WINDOW_MS) {
    throw new ReviewError('undo-expired');
  }

  const [latest] = await db
    .select({ id: reviewLogs.id })
    .from(reviewLogs)
    .where(eq(reviewLogs.cardId, log.cardId))
    .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
    .limit(1);
  if (latest?.id !== log.id) throw new ReviewError('undo-not-latest');

  try {
    await db.delete(reviewLogs).where(eq(reviewLogs.id, logId));
  } catch (error) {
    console.error('[undoReview] failed', error);
    throw new ReviewError('write-failed');
  }

  const folded = await loadFoldedCard(log.cardId);
  if (!folded) throw new ReviewError('card-missing');
  await stateUpsert(log.cardId, folded.card);

  return {
    cardId: log.cardId,
    state: toStateView(folded.card),
    previews: toPreviews(folded.card, now, folded.params),
    counts: await getDailyCounts(now),
  };
}

/** §5 — recomputes one card from its log and stores the result. */
export async function recomputeCardState(cardId: string): Promise<CardStateView> {
  const folded = await loadFoldedCard(cardId);
  if (!folded) throw new Error(`No such card ${cardId}`);
  await stateUpsert(cardId, folded.card);
  return toStateView(folded.card);
}

export interface RecomputeReport {
  total: number;
  unchanged: number;
  drifted: { cardId: string; field: string; stored: unknown; computed: unknown }[];
}

/**
 * `npm run recompute` — rebuilds every row (§5). Reads in card batches so that
 * years of logs never land in a single round trip.
 */
export async function recomputeAllCardStates(
  options: { write?: boolean } = {},
): Promise<RecomputeReport> {
  const write = options.write ?? true;
  const settings = await getSettings();
  const params = schedulerParams(settings.requestRetention);

  const allCards: CardRow[] = await db
    .select({ cardId: cards.id, wordId: cards.wordId, createdAt: words.createdAt })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.wordId))
    .orderBy(asc(words.createdAt));

  const stored = new Map((await db.select().from(cardStates)).map((s) => [s.cardId, s] as const));

  const report: RecomputeReport = { total: allCards.length, unchanged: 0, drifted: [] };
  const BATCH = 200;

  for (let i = 0; i < allCards.length; i += BATCH) {
    const chunk = allCards.slice(i, i + BATCH);
    const logsByCard = groupLogs(await selectLogs(chunk.map((c) => c.cardId)));
    const writes: ReturnType<typeof stateUpsert>[] = [];

    for (const row of chunk) {
      const card = foldLogs(row.createdAt, logsByCard.get(row.cardId) ?? [], params);
      const diff = compareState(stored.get(row.cardId), card);
      if (!diff) {
        report.unchanged++;
        continue;
      }
      report.drifted.push({ cardId: row.cardId, ...diff });
      if (write) writes.push(stateUpsert(row.cardId, card));
    }

    if (writes.length > 0) {
      await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
    }
  }

  return report;
}

/** The one writer of `card_states`. Returns the statement so callers can batch it. */
export function stateUpsert(cardId: string, card: Card) {
  const values = toStateRow(cardId, card);
  const { cardId: _pk, ...set } = values;
  return db.insert(cardStates).values(values).onConflictDoUpdate({
    target: cardStates.cardId,
    set,
  });
}

function toStateRow(cardId: string, card: Card) {
  const isNew = card.state === State.New;
  return {
    cardId,
    due: card.due,
    // ts-fsrs reports 0/0 for an untouched card; the columns are nullable and
    // "not measured yet" is not the same thing as zero.
    stability: isNew ? null : card.stability,
    difficulty: isNew ? null : card.difficulty,
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ?? null,
  };
}

export function toStateView(card: Card): CardStateView {
  const row = toStateRow('', card);
  return {
    due: row.due.toISOString(),
    stability: row.stability,
    difficulty: row.difficulty,
    state: row.state,
    reps: row.reps,
    lapses: row.lapses,
    lastReview: row.lastReview?.toISOString() ?? null,
  };
}

export function toPreviews(card: Card, now: Date, params: FsrsParams): RatingPreviews {
  const due = previewDueDates(card, now, params);
  return {
    1: formatInterval(due[1].getTime() - now.getTime()),
    2: formatInterval(due[2].getTime() - now.getTime()),
    3: formatInterval(due[3].getTime() - now.getTime()),
    4: formatInterval(due[4].getTime() - now.getTime()),
  };
}

/** A card put back by a learning step returns inside the session; anything further out leaves it. */
export function staysInSession(card: Card, now: Date): boolean {
  return card.due.getTime() - now.getTime() <= LEARN_AHEAD_MINUTES * 60_000;
}

function selectLogs(cardIds: readonly string[]) {
  return db
    .select({
      id: reviewLogs.id,
      cardId: reviewLogs.cardId,
      rating: reviewLogs.rating,
      reviewedAt: reviewLogs.reviewedAt,
    })
    .from(reviewLogs)
    .where(inArray(reviewLogs.cardId, [...cardIds]))
    .orderBy(asc(reviewLogs.reviewedAt));
}

function groupLogs(rows: readonly (ReplayLog & { cardId: string })[]): Map<string, ReplayLog[]> {
  const map = new Map<string, ReplayLog[]>();
  for (const row of rows) {
    const list = map.get(row.cardId) ?? [];
    list.push({ id: row.id, rating: row.rating, reviewedAt: row.reviewedAt });
    map.set(row.cardId, list);
  }
  return map;
}

/**
 * `stability` and `difficulty` are `real` — float4 — so a float64 fold never
 * compares equal to what Postgres hands back. `Math.fround` collapses both to
 * the stored precision, which is what makes "reproduces every state exactly"
 * a check that can actually pass rather than a tolerance fudge.
 */
function compareState(
  stored: typeof cardStates.$inferSelect | undefined,
  card: Card,
): { field: string; stored: unknown; computed: unknown } | null {
  if (!stored) return { field: 'row', stored: null, computed: 'missing' };
  const computed = toStateRow(stored.cardId, card);

  if (stored.due.getTime() !== computed.due.getTime()) {
    return { field: 'due', stored: stored.due.toISOString(), computed: computed.due.toISOString() };
  }
  if (stored.state !== computed.state) {
    return { field: 'state', stored: stored.state, computed: computed.state };
  }
  if (stored.reps !== computed.reps) {
    return { field: 'reps', stored: stored.reps, computed: computed.reps };
  }
  if (stored.lapses !== computed.lapses) {
    return { field: 'lapses', stored: stored.lapses, computed: computed.lapses };
  }
  if ((stored.lastReview?.getTime() ?? null) !== (computed.lastReview?.getTime() ?? null)) {
    return {
      field: 'lastReview',
      stored: stored.lastReview?.toISOString() ?? null,
      computed: computed.lastReview?.toISOString() ?? null,
    };
  }
  if (!sameFloat(stored.stability, computed.stability)) {
    return { field: 'stability', stored: stored.stability, computed: computed.stability };
  }
  if (!sameFloat(stored.difficulty, computed.difficulty)) {
    return { field: 'difficulty', stored: stored.difficulty, computed: computed.difficulty };
  }
  return null;
}

function sameFloat(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.fround(a) === Math.fround(b);
}
