import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, inArray, lte, not, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getSettings, hydrateWords } from '@/lib/db/queries';
import { cardStates, cards, reviewLogs, words } from '@/lib/db/schema';
import { startOfNextStudyDay, startOfStudyDay } from '@/lib/fsrs/day';
import { LEARN_AHEAD_MINUTES, LEECH_LAPSES, schedulerParams } from '@/lib/fsrs/params';
import {
  buildQueue,
  expandFaces,
  type QueueCandidate,
  type QueueShowing,
} from '@/lib/fsrs/queue';
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

/**
 * What a session may deal, as SQL rather than as a loop.
 *
 * One card per word is a database constraint now, so "in rotation" is just
 * "the word is not suspended" — `cards.card_type` and `cards.active` used to
 * add two more clauses here and neither ever excluded a row a session wanted.
 *
 * These earn their place beyond tidiness. The session used to read every card
 * in the collection and sort it out in JavaScript, which is nothing at fifty
 * words and is a full scan plus a full transfer at twenty thousand. Expressed
 * this way the daily caps become `LIMIT`s, and the work stops being
 * proportional to the size of the collection.
 */
const inRotation = eq(words.suspended, false);

/** ts-fsrs `State.New` — a card with no review history. */
const isNew = eq(cardStates.state, State.New);

/**
 * Due now, or due close enough that a reload should resume rather than
 * announce the day is over. A card put back by a learning step is due in a
 * minute or ten; only learning states sit that close, since anything in Review
 * is a day away at least.
 */
function isDue(now: Date) {
  const learnAhead = new Date(now.getTime() + LEARN_AHEAD_MINUTES * 60_000);
  return or(
    lte(cardStates.due, now),
    and(
      inArray(cardStates.state, [State.Learning, State.Relearning]),
      lte(cardStates.due, learnAhead),
    ),
  )!;
}

/**
 * The one pass both entry points share: how much is waiting, and when the next
 * thing lands. Four numbers off one indexed scan, rather than every row in the
 * collection crossing the wire to be counted in a loop.
 *
 * `nextDue` is the earliest card that is neither new nor in today's session —
 * the "come back at" time, which only means anything once today is empty.
 */
async function scanRotation(now: Date): Promise<{
  total: number;
  newCards: number;
  dueReviews: number;
  nextDue: Date | null;
}> {
  const due = isDue(now);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      newCards: sql<number>`count(*) filter (where ${isNew})::int`,
      dueReviews: sql<number>`count(*) filter (where ${due} and not ${isNew})::int`,
      nextDue: sql<Date | null>`min(${cardStates.due}) filter (where not ${due} and not ${isNew})`,
    })
    .from(cards)
    .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(inRotation);

  return {
    total: row?.total ?? 0,
    newCards: row?.newCards ?? 0,
    dueReviews: row?.dueReviews ?? 0,
    nextDue: row?.nextDue ? new Date(row.nextDue) : null,
  };
}

/** Every card is asked from both sides, so a session is twice its cards long. */
const FACES_PER_CARD = 2;
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
 * How many showings today's session would actually hand you — the nav badge.
 *
 * The same scan and the same cap arithmetic as `buildSession`, stopping
 * before `hydrateQueue`. Counting raw due rows instead would be cheaper and
 * wrong: the badge would say 240 on a morning the caps release 100, and a
 * number the session then contradicts is worse than no number.
 *
 * Doubled for the same reason. Every card is asked from both sides, so the
 * caps release twelve *words* and the session is twenty-four cards long — and
 * the badge is a promise about how much work is waiting, not about how much
 * vocabulary it covers.
 */
export async function countDueToday(now = new Date()): Promise<number> {
  const [settings, countedCards, scan] = await Promise.all([
    getSettings(),
    getCountedCards(now),
    scanRotation(now),
  ]);
  const counts = tallyCounts(countedCards);

  const reviewLimit = Math.max(0, settings.reviewsPerDay - counts.reviewCards);
  const newLimit = Math.max(0, settings.newPerDay - counts.newCards);
  return (
    (Math.min(scan.dueReviews, reviewLimit) + Math.min(scan.newCards, newLimit)) * FACES_PER_CARD
  );
}

/**
 * The day's session. The caps are applied once, here: there is no "study
 * more" escape hatch, so the queue the client receives is the whole day.
 */
export async function buildSession(now = new Date()): Promise<SessionView> {
  const [settings, countedCards, scan] = await Promise.all([
    getSettings(),
    getCountedCards(now),
    scanRotation(now),
  ]);
  const params = schedulerParams(settings.requestRetention);
  const counts = tallyCounts(countedCards);

  const reviewLimit = Math.max(0, settings.reviewsPerDay - counts.reviewCards);
  const newLimit = Math.max(0, settings.newPerDay - counts.newCards);

  // Only what the caps can actually release, in the order the caps would
  // release it: most overdue first, and new cards in the order they were
  // added. The rows that lose the cap never leave the database.
  const selected = {
    cardId: cards.id,
    wordId: cards.wordId,
    leechAckedAt: cards.leechAckedAt,
    due: cardStates.due,
    state: cardStates.state,
    createdAt: words.createdAt,
  };
  const inSession = isDue(now);

  const [dueRows, newRows] = await Promise.all([
    reviewLimit === 0
      ? []
      : db
          .select(selected)
          .from(cards)
          .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
          .innerJoin(words, eq(words.id, cards.wordId))
          .where(and(inRotation, inSession, not(isNew)))
          .orderBy(asc(cardStates.due), asc(cards.id))
          .limit(reviewLimit),
    newLimit === 0
      ? []
      : db
          .select(selected)
          .from(cards)
          .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
          .innerJoin(words, eq(words.id, cards.wordId))
          .where(and(inRotation, isNew))
          // `sort_order` breaks the tie inside an import, where a thousand
          // words share one `created_at` and insertion order means nothing.
          .orderBy(asc(words.createdAt), asc(words.sortOrder), asc(cards.id))
          .limit(newLimit),
  ]);

  // The row's position, not its timestamp. `buildQueue` sorts by `order`, and
  // re-deriving that key from `due`/`created_at` would quietly throw away the
  // `sort_order` tiebreak the query just applied — a thousand imported words
  // share one `created_at`, so the sort would fall through to the card's UUID.
  // The database has already put these in the right order; this keeps it
  // rather than guessing at it a second time.
  const position = (rows: typeof dueRows): QueueCandidate[] =>
    rows.map((row, i) => ({ cardId: row.cardId, wordId: row.wordId, order: i }));

  const dueReviews = position(dueRows);
  const newCards = position(newRows);

  const queue = buildQueue({ reviews: dueReviews, news: newCards, reviewLimit, newLimit });

  // The caps are spent on cards, and each card is then asked twice. So a
  // `newPerDay` of 12 is twelve *words* and twenty-four showings — the number
  // in Cài đặt still means what it says, and the session is twice as long as
  // the number suggests. Seeded by the study day so a reload resumes the queue
  // it built this morning rather than dealing a new one.
  const showings = expandFaces(queue, startOfStudyDay(now).getTime());

  const meta = new Map([...dueRows, ...newRows].map((c) => [c.cardId, c]));
  const items = await hydrateQueue(showings, meta, params, now);

  return {
    now: now.toISOString(),
    items,
    countedCards,
    limits: { newPerDay: settings.newPerDay, reviewsPerDay: settings.reviewsPerDay },
    requestRetention: settings.requestRetention,
    // From the scan, not from the queue: the rows the caps held back were
    // never fetched, so what is waiting has to be counted by the side that
    // counted everything.
    heldBack: {
      newCards: Math.max(0, scan.newCards - newLimit),
      reviewCards: Math.max(0, scan.dueReviews - reviewLimit),
    },
    nextDue: scan.nextDue?.toISOString() ?? null,
    nextDayStart: startOfNextStudyDay(now).toISOString(),
    totalCards: scan.total,
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
  queue: readonly QueueShowing[],
  meta: Map<string, { leechAckedAt: Date | null; createdAt: Date }>,
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

  // Folded once per card, not once per showing: the two faces are the same
  // card and must carry the same state, or the second would render previews
  // from a different fold of the same log.
  const folds = new Map<string, ReturnType<typeof foldLogs>>();

  const items: ReviewItem[] = [];
  for (const entry of queue) {
    const card = meta.get(entry.cardId);
    const word = wordViews.get(entry.wordId);
    if (!card || !word) continue;

    let folded = folds.get(entry.cardId);
    if (!folded) {
      folded = foldLogs(card.createdAt, logsByCard.get(entry.cardId) ?? [], params);
      folds.set(entry.cardId, folded);
    }

    items.push({
      cardId: entry.cardId,
      face: entry.face,
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
 *
 * The same id can arrive twice meaning two different things, and this is what
 * tells them apart. A retry or a double submit repeats the rating it already
 * wrote — the fold already contains it, and the log line below hands back the
 * state it implies. A *correction* repeats the id with a different rating: the
 * pair rule's second face disagreed with the first, and this rewrites the
 * review as though only the worse of the two had happened. Ratings no longer
 * wait in the outbox for their twin — see `flush` — so this, not a held-back
 * send, is what makes the pair correction durable and offline-safe: the
 * corrected rating is just another queued write, and the server already knows
 * what to do with a review under an id it has seen before.
 */
export async function applyReview(input: {
  /** `review_logs.id`, generated by the caller — the idempotency key. */
  logId: string;
  cardId: string;
  rating: RatingValue;
  now?: Date;
}): Promise<RateResult> {
  const now = input.now ?? new Date();

  // A suspended word rejects the review: suspension takes the word out of the
  // collection, not merely out of rotation.
  const [available] = await db
    .select({
      id: cards.id,
      wordId: cards.wordId,
      leechAckedAt: cards.leechAckedAt,
      wordCreatedAt: words.createdAt,
    })
    .from(cards)
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.id, input.cardId), eq(words.suspended, false)))
    .limit(1);
  if (!available) throw new ReviewError('card-unavailable');

  const [existing] = await db
    .select({ id: reviewLogs.id, rating: reviewLogs.rating })
    .from(reviewLogs)
    .where(eq(reviewLogs.id, input.logId))
    .limit(1);

  // A correction, not a retry. Guarded the way undo is guarded — only the
  // card's still-latest review may be replaced — minus undo's ten-second
  // window: that window bounds an interactive "hoàn tác" the toast can only
  // offer for ten seconds, but a pair correction can arrive any time before
  // the study day ends. What has to hold regardless of timing is the
  // ordering: a correction that has fallen behind a real review written since
  // must never win against it.
  if (existing && existing.rating !== input.rating) {
    const [latest] = await db
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .where(eq(reviewLogs.cardId, input.cardId))
      .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
      .limit(1);
    if (latest?.id !== input.logId) throw new ReviewError('undo-not-latest');

    try {
      await db.delete(reviewLogs).where(eq(reviewLogs.id, input.logId));
    } catch (error) {
      console.error('[applyReview] failed to replace', error);
      throw new ReviewError('write-failed');
    }
  }

  const folded = await loadFoldedCard(input.cardId);
  if (!folded) throw new ReviewError('card-missing');

  // The ordinary retry: same id, same rating, nothing left to do. Checked
  // after the fold rather than before so the correction above and this share
  // one `loadFoldedCard` call instead of two.
  if (existing && existing.rating === input.rating) {
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
        // Defensive, not load-bearing: the id was just confirmed absent
        // (fresh) or deleted (correction) above, in the same request. A
        // conflict here means a concurrent write slipped in between, and
        // keeping whatever it wrote is safer than throwing this one away.
        .onConflictDoNothing({ target: reviewLogs.id }),
      stateUpsert(input.cardId, next.card),
    ]);
  } catch (error) {
    console.error('[applyReview] failed', error);
    throw new ReviewError('write-failed');
  }

  return describe(input.cardId, next.card, reviewedAt, folded.params, {
    leechAcked: available.leechAckedAt !== null,
  });
}

function describe(
  cardId: string,
  card: Card,
  now: Date,
  params: FsrsParams,
  flags: { leechAcked: boolean },
): RateResult {
  return {
    cardId,
    state: toStateView(card),
    previews: toPreviews(card, now, params),
    repeat: staysInSession(card, now),
    leech: !flags.leechAcked && card.lapses >= LEECH_LAPSES,
  };
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
 *
 * `undo-not-latest` belongs here for the same reason: a pair correction that
 * has lost the ordering race — a real review landed for the card after it —
 * will never win that race on a later retry either. Dropping it leaves the
 * newer, real review standing, which is the correct outcome, not a fallback.
 */
const PERMANENT: ReadonlySet<ReviewFailure> = new Set([
  'card-unavailable',
  'card-missing',
  'undo-not-latest',
]);

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
