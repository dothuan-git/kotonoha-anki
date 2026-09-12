import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getSettings, hydrateWords } from '@/lib/db/queries';
import { cardStates, cards, reviewLogs, words } from '@/lib/db/schema';
import { startOfNextStudyDay, startOfStudyDay } from '@/lib/fsrs/day';
import { LEARN_AHEAD_MINUTES, LEECH_LAPSES, schedulerParams } from '@/lib/fsrs/params';
import { buildQueue, type QueueCandidate, type QueueEntry } from '@/lib/fsrs/queue';
import {
  State,
  applyRating,
  foldLogs,
  type Card,
  type RatingValue,
  type ReplayLog,
} from '@/lib/fsrs/replay';
import { staysInSession, toCard, toPreviews, toStateView } from '@/lib/fsrs/state';
import { UNDO_WINDOW_MS, tallyCounts } from '@/lib/types';
import type {
  CardStateView,
  CountedCards,
  DailyCounts,
  PendingReview,
  RateResult,
  ReviewItem,
  SessionView,
  SyncResult,
  UndoResult,
} from '@/lib/types';

/**
 * Everything here treats `card_states` as a cache of a fold over
 * `review_logs`. It is written in exactly one place — `stateUpsert` — and
 * always from a freshly folded card. No stored state is ever mutated in place.
 */

type FsrsParams = ReturnType<typeof schedulerParams>;
type CardRow = { cardId: string; wordId: string; createdAt: Date };

/**
 * Which cards the daily caps have been spent on since the study day began.
 *
 * Per card rather than per log row, and each card counts once: a new card
 * walking its learning steps writes several rows the same day, and those
 * repeats must not also eat a review slot. A card counts as new if its first
 * showing today was its first showing ever.
 *
 * The identities rather than the totals, because the client has to keep the
 * same books while offline and needs to know whether a card it is about to
 * rate was already counted this morning.
 */
export async function getCountedCards(now = new Date()): Promise<CountedCards> {
  const rows = await db
    .select({
      cardId: reviewLogs.cardId,
      wasNew: sql<boolean>`bool_or(${reviewLogs.state} = 0)`,
    })
    .from(reviewLogs)
    .where(gte(reviewLogs.reviewedAt, startOfStudyDay(now)))
    .groupBy(reviewLogs.cardId);

  const counted: CountedCards = {};
  for (const row of rows) counted[row.cardId] = row.wasNew ? 'new' : 'review';
  return counted;
}

export async function getDailyCounts(now = new Date()): Promise<DailyCounts> {
  return tallyCounts(await getCountedCards(now));
}

/**
 * How many cards today's session would actually hand you — the nav badge.
 *
 * The same scan and the same cap arithmetic as `buildSession`, stopping
 * before `hydrateQueue`. Counting raw due rows instead would be cheaper and
 * wrong: the badge would say 240 on a morning the caps release 100, and a
 * number the session then contradicts is worse than no number.
 */
export async function countDueToday(now = new Date()): Promise<number> {
  const [settings, countedCards] = await Promise.all([getSettings(), getCountedCards(now)]);
  const counts = tallyCounts(countedCards);

  const candidates = await db
    .select({
      cardId: cards.id,
      due: cardStates.due,
      state: cardStates.state,
    })
    .from(cards)
    .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.active, true), eq(words.suspended, false)));

  const learnAhead = now.getTime() + LEARN_AHEAD_MINUTES * 60_000;
  let dueReviews = 0;
  let newCards = 0;

  for (const row of candidates) {
    const due = row.due.getTime();
    if (row.state === State.New) {
      newCards++;
    } else if (
      due <= now.getTime() ||
      ((row.state === State.Learning || row.state === State.Relearning) && due <= learnAhead)
    ) {
      dueReviews++;
    }
  }

  const reviewLimit = Math.max(0, settings.reviewsPerDay - counts.reviewCards);
  const newLimit = Math.max(0, settings.newPerDay - counts.newCards);
  return Math.min(dueReviews, reviewLimit) + Math.min(newCards, newLimit);
}

/**
 * The day's session. The caps are applied once, here: there is no "study
 * more" escape hatch, so the queue the client receives is the whole day.
 */
export async function buildSession(now = new Date()): Promise<SessionView> {
  const [settings, countedCards] = await Promise.all([getSettings(), getCountedCards(now)]);
  const params = schedulerParams(settings.requestRetention);
  const counts = tallyCounts(countedCards);

  const candidates = await db
    .select({
      cardId: cards.id,
      wordId: cards.wordId,
      cardType: cards.cardType,
      leechAckedAt: cards.leechAckedAt,
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
    countedCards,
    limits: { newPerDay: settings.newPerDay, reviewsPerDay: settings.reviewsPerDay },
    requestRetention: settings.requestRetention,
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
  meta: Map<
    string,
    { cardType: ReviewItem['cardType']; leechAckedAt: Date | null; createdAt: Date }
  >,
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
      leechAcked: card.leechAckedAt !== null,
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
 * The scheduling lives here rather than in the server action so that
 * `/api/sync` replays an offline batch through exactly this path instead of a
 * parallel implementation that can drift from it.
 */
export async function applyReview(input: {
  /** `review_logs.id`, generated by the caller — the idempotency key. */
  logId: string;
  cardId: string;
  rating: RatingValue;
  now?: Date;
}): Promise<RateResult> {
  const now = input.now ?? new Date();

  // `active` is deliberately not part of this guard, though the queue filters
  // on it. It decides what a session *hands you*; it does not decide whether a
  // review that has already happened may be recorded. The leech rule
  // deactivates a production card mid-session, and the rating that triggered it
  // is at that moment sitting in the outbox — rejecting it would throw away a
  // review the user actually did. A suspended word still rejects: suspension
  // takes the word out of the collection, not out of rotation.
  const [available] = await db
    .select({
      id: cards.id,
      wordId: cards.wordId,
      cardType: cards.cardType,
      leechAckedAt: cards.leechAckedAt,
      wordCreatedAt: words.createdAt,
    })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.id, input.cardId), eq(words.suspended, false)))
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
  if (existing) {
    return describe(input.cardId, folded.card, now, folded.params, {
      leechAcked: available.leechAckedAt !== null,
    });
  }

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

  // Checked after every review, on the card that just moved.
  const unlockedProduction =
    available.cardType === 'recognition'
      ? await unlockProductionCard(available.wordId, available.wordCreatedAt, next.card)
      : false;

  return describe(input.cardId, next.card, reviewedAt, folded.params, {
    unlockedProduction,
    leechAcked: available.leechAckedAt !== null,
  });
}

function describe(
  cardId: string,
  card: Card,
  now: Date,
  params: FsrsParams,
  flags: { unlockedProduction?: boolean; leechAcked: boolean },
): RateResult {
  return {
    cardId,
    state: toStateView(card),
    previews: toPreviews(card, now, params),
    repeat: staysInSession(card, now),
    unlockedProduction: flags.unlockedProduction ?? false,
    leech: !flags.leechAcked && card.lapses >= LEECH_LAPSES,
  };
}

/** Created and activated automatically once the recognition card's stability >= 21. */
export const PRODUCTION_UNLOCK_STABILITY = 21;

/**
 * Creates the word's production card once its recognition card is solid enough.
 *
 * The new card's state row is `createEmptyCard(word.created_at)` — the same
 * seed every other fold uses — so `npm run recompute` reproduces it
 * exactly instead of moving it to whenever the rebuild happened to run. Being
 * due in the past is the point: it is a new card and belongs in the next
 * session, not this one (a word never shows two cards in one session).
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
 * rebuild the card from what remains. Nothing is compensated or patched —
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
    countedCards: await getCountedCards(now),
  };
}

/**
 * Permanent rejections: a log the server will never accept, however often the
 * outbox retries. The client drops these, because retrying one forever wedges
 * every review queued behind it.
 */
const PERMANENT: ReadonlySet<ReviewFailure> = new Set(['card-unavailable', 'card-missing']);

/**
 * Replay an offline batch.
 *
 * The batch goes through `applyReview`, the same function a rating has always
 * gone through, so an offline review and an online one cannot land on
 * different schedules. Each row carries the timestamp of the moment it was
 * rated, so a card reviewed on the train is scheduled from the train, not from
 * whenever the signal came back.
 *
 * Ordered by `reviewedAt` across the whole batch. Two devices that were both
 * offline interleave here, and because state is a fold the result is the
 * same whichever device reconnects first.
 *
 * Nothing here is atomic and nothing needs to be: every insert is idempotent
 * on the client-generated id, so a half-applied batch that is POSTed again
 * simply finishes.
 */
export async function syncReviews(
  batch: readonly PendingReview[],
  now = new Date(),
): Promise<SyncResult> {
  const ordered = [...batch].sort(
    (a, b) =>
      Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const applied: string[] = [];
  const rejected: SyncResult['rejected'] = [];
  const states: SyncResult['states'] = {};
  const unlocked: string[] = [];
  const leeches = new Set<string>();

  for (const entry of ordered) {
    // A device clock that runs fast would otherwise schedule from the future
    // and hold the card back for days. Behind is fine and expected — that is
    // what being offline means — so only the future is clamped.
    const reviewedAt = new Date(Math.min(Date.parse(entry.reviewedAt), now.getTime()));

    try {
      const result = await applyReview({
        logId: entry.id,
        cardId: entry.cardId,
        rating: entry.rating,
        now: reviewedAt,
      });
      applied.push(entry.id);
      states[entry.cardId] = { state: result.state, previews: result.previews };
      if (result.unlockedProduction) unlocked.push(entry.cardId);
      // The leech prompt, for the card whose sixth lapse happened on another
      // device. The one in front of you worked this out without a round trip.
      if (result.leech) leeches.add(entry.cardId);

    } catch (error) {
      if (error instanceof ReviewError && PERMANENT.has(error.reason)) {
        rejected.push({ id: entry.id, reason: error.reason });
        continue;
      }
      // Transient — a failed write, a dropped connection. Listed as neither
      // applied nor rejected, so the entry stays in the outbox and the next
      // flush tries again.
      console.error('[syncReviews] entry failed', entry.id, error);
    }
  }

  // The interval previews came back relative to when each review happened,
  // which for a batch off a week-old outbox is a week ago. The buttons they
  // label are being pressed now, so they are recomputed against now.
  if (applied.length > 0) {
    const settings = await getSettings();
    const params = schedulerParams(settings.requestRetention);
    for (const cardId of Object.keys(states)) {
      const entry = states[cardId];
      if (entry) entry.previews = toPreviews(toCard(entry.state), now, params);
    }
  }

  // Counted against the server's own clock rather than the batch's, because
  // the daily caps are spent against the study day that is running now.
  return {
    applied,
    rejected,
    states,
    unlocked,
    leeches: [...leeches],
    countedCards: await getCountedCards(now),
  };
}

/** Recomputes one card from its log and stores the result. */
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
 * `npm run recompute` — rebuilds every row. Reads in card batches so that
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

export { staysInSession, toPreviews, toStateView };

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
