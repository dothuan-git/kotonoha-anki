import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { getSettings, hydrateWords } from '@/lib/db/queries';
import { cardStates, cards, reviewLogs, words } from '@/lib/db/schema';
import { startOfStudyDay } from '@/lib/fsrs/day';
import { LEARN_AHEAD_MINUTES, LEECH_LAPSES, schedulerParams } from '@/lib/fsrs/params';
import {
  buildQueue,
  expandFaces,
  sessionSlots,
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
import { UNDO_WINDOW_MS } from '@/lib/types';
import type {
  CardStateView,
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
 * this way the session budget becomes a `LIMIT`, and the work stops being
 * proportional to the size of the collection.
 */
export const inRotation = eq(words.suspended, false);

/** ts-fsrs `State.New` — a card with no review history. */
export const isNew = eq(cardStates.state, State.New);

/**
 * The two halves of "due", kept apart because the session budgets them
 * differently: a card put back by a learning step is dealt whatever the budget
 * says, a merely due card spends it.
 *
 * A learning card is due in a minute or ten, so it is taken slightly ahead of
 * time — a reload should resume the session rather than announce it is over.
 * Only learning states sit that close; anything in Review is a day away at
 * least, which is why the review half needs no such tolerance.
 */
function dealable(now: Date) {
  const learnAhead = new Date(now.getTime() + LEARN_AHEAD_MINUTES * 60_000);
  return {
    learning: and(
      inArray(cardStates.state, [State.Learning, State.Relearning]),
      lte(cardStates.due, learnAhead),
    )!,
    review: and(eq(cardStates.state, State.Review), lte(cardStates.due, now))!,
  };
}

/**
 * The one pass both entry points share: how much is waiting, and when the next
 * thing lands. Five numbers off one indexed scan, rather than every row in the
 * collection crossing the wire to be counted in a loop.
 *
 * `learningCards` is counted apart from `dueReviews` rather than folded in
 * with it. They are budgeted differently, and a single total would make
 * `remaining` count the free riders a session just dealt as still waiting —
 * a finish screen that claims there is more work, forever.
 *
 * `nextDue` is the earliest card that is neither new nor dealable now — the
 * "come back at" time, which only means anything once nothing is waiting.
 */
async function scanRotation(now: Date): Promise<{
  total: number;
  newCards: number;
  dueReviews: number;
  learningCards: number;
  nextDue: Date | null;
}> {
  const { learning, review } = dealable(now);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      newCards: sql<number>`count(*) filter (where ${isNew})::int`,
      dueReviews: sql<number>`count(*) filter (where ${review})::int`,
      learningCards: sql<number>`count(*) filter (where ${learning})::int`,
      nextDue: sql<Date | null>`min(${cardStates.due}) filter (where not ${isNew} and not ${review} and not ${learning})`,
    })
    .from(cards)
    .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(inRotation);

  return {
    total: row?.total ?? 0,
    newCards: row?.newCards ?? 0,
    dueReviews: row?.dueReviews ?? 0,
    learningCards: row?.learningCards ?? 0,
    nextDue: row?.nextDue ? new Date(row.nextDue) : null,
  };
}

/** Every card is asked from both sides, so a session is twice its cards long. */
const FACES_PER_CARD = 2;

type CardRow = { cardId: string; wordId: string; createdAt: Date };

/**
 * How many showings the next session would hand you — the nav badge.
 *
 * The same scan and the same `sessionSlots` call as `buildSession`, stopping
 * before `hydrateQueue`. Counting raw due rows instead would be cheaper and
 * wrong: the badge would say 240 on a morning the session deals 100, and a
 * number the session then contradicts is worse than no number.
 *
 * The next session rather than everything outstanding, now that everything
 * outstanding is reachable in a few sittings. A badge reading 4800 after a
 * fortnight away is not information; the finish screen carries the real total.
 *
 * Doubled because every card is asked from both sides — the badge is a promise
 * about how much work is waiting, not about how much vocabulary it covers.
 */
export async function countNextSession(now = new Date()): Promise<number> {
  const [settings, scan] = await Promise.all([getSettings(), scanRotation(now)]);

  const cap = settings.cardsPerSession;
  const slots = sessionSlots({
    dueReviews: scan.dueReviews,
    newCards: scan.newCards,
    learning: scan.learningCards,
    cap,
  });
  return (Math.min(scan.learningCards, cap) + slots.reviews + slots.news) * FACES_PER_CARD;
}

/**
 * A ceiling on learning cards, not a policy.
 *
 * They are dealt whatever the budget says, so nothing here should ever bind —
 * a card mid-way through its steps must not be held to tomorrow. It exists so
 * a collection that somehow accumulated thousands of them cannot ask for all
 * of them in one round trip. Deliberately not tied to `cardsPerSession`: a
 * small session size would then also throttle cards you are part-way through,
 * which is the opposite of the intent.
 */
const FREE_RIDERS = 200;

/** The session in hand, plus one held back so a finished session can be replaced offline. */
const LOOKAHEAD_SESSIONS = 2;

/**
 * The session, plus the one after it.
 *
 * The budget is applied here, once. There is no daily ceiling any more: a card
 * that was rated has a future `due` and simply is not in the next query, so
 * finishing a session and asking for another deals the next cards by the same
 * rule that dealt these.
 *
 * The second session rides along unasked because the reviewer has to work
 * offline. The client cannot build a queue — it has no words, sentences or
 * logs for cards it was never handed — so without a lookahead, finishing a
 * session on a train would end the day. Two sessions of fifty is a hundred
 * cards, below what a single day's queue used to carry, so this costs nothing
 * that was not already being paid.
 */
export async function buildSession(now = new Date()): Promise<SessionView> {
  const [settings, scan] = await Promise.all([getSettings(), scanRotation(now)]);
  const params = schedulerParams(settings.requestRetention);
  const cap = settings.cardsPerSession;

  const selected = {
    cardId: cards.id,
    wordId: cards.wordId,
    leechAckedAt: cards.leechAckedAt,
    due: cardStates.due,
    state: cardStates.state,
    createdAt: words.createdAt,
  };
  const { learning, review } = dealable(now);
  const from = () =>
    db
      .select(selected)
      .from(cards)
      .innerJoin(cardStates, eq(cardStates.cardId, cards.id))
      .innerJoin(words, eq(words.id, cards.wordId));

  // Three queries, not two. Merging the first into the second would sort
  // overdue reviews ahead of learning cards — which are due a few minutes out
  // — so a shared LIMIT would truncate exactly the rows that must not be.
  // Each budgeted stream fetches what two sessions could possibly take.
  const reach = LOOKAHEAD_SESSIONS * cap;
  const [learningRows, dueRows, newRows] = await Promise.all([
    from()
      .where(and(inRotation, learning))
      .orderBy(asc(cardStates.due), asc(cards.id))
      .limit(FREE_RIDERS),
    reach === 0
      ? []
      : from()
          .where(and(inRotation, review))
          .orderBy(asc(cardStates.due), asc(cards.id))
          .limit(reach),
    reach === 0
      ? []
      : from()
          .where(and(inRotation, isNew))
          // `sort_order` breaks the tie inside an import, where a thousand
          // words share one `created_at` and insertion order means nothing.
          .orderBy(asc(words.createdAt), asc(words.sortOrder), asc(cards.id))
          .limit(reach),
  ]);

  // Due rows carry the timestamp, because learning and review candidates are
  // merged into one stream and have to be comparable across it. New rows carry
  // the row's position instead: re-deriving a key from `created_at` would
  // throw away the `sort_order` tiebreak the query just applied, since a
  // thousand imported words share one `created_at` and the sort would fall
  // through to the card's UUID.
  const byDue = (rows: typeof dueRows): QueueCandidate[] =>
    rows.map((row) => ({ cardId: row.cardId, wordId: row.wordId, order: row.due.getTime() }));
  const byPosition = (rows: typeof newRows): QueueCandidate[] =>
    rows.map((row, i) => ({ cardId: row.cardId, wordId: row.wordId, order: i }));

  const reviewPool = byDue(dueRows);
  const newPool = byPosition(newRows);

  const queue = buildQueue({
    learning: byDue(learningRows),
    reviews: reviewPool,
    news: newPool,
    cap,
  });

  // The session after this one, from the rows this one did not take. Learning
  // cards are all dealt now, so the lookahead is reviews and new words only.
  const dealt = new Set(queue.map((entry) => entry.cardId));
  const left = (pool: QueueCandidate[]) => pool.filter((c) => !dealt.has(c.cardId));
  const dealtFrom = (pool: QueueCandidate[]) => pool.length - left(pool).length;
  const nextQueue = buildQueue({
    learning: [],
    reviews: left(reviewPool),
    news: left(newPool),
    cap,
  });

  // The budget is spent on cards and each card is then asked twice, so a cap
  // of 50 is fifty *words* and a hundred showings — the number in Cài đặt
  // means what it says, and the session is twice as long as it sounds.
  //
  // Seeded by the study day so that a re-render before the queue has been
  // stored deals the same order that is already on screen. The lookahead is
  // offset by one so the two sessions do not shuffle in lockstep.
  const seed = startOfStudyDay(now).getTime();
  const meta = new Map([...learningRows, ...dueRows, ...newRows].map((c) => [c.cardId, c]));
  const [items, next] = await Promise.all([
    hydrateQueue(expandFaces(queue, seed), meta, params, now),
    hydrateQueue(expandFaces(nextQueue, seed + 1), meta, params, now),
  ]);

  return {
    now: now.toISOString(),
    items,
    next,
    cardsPerSession: cap,
    requestRetention: settings.requestRetention,
    // From the scan, not from the queue: the rows that did not fit were never
    // fetched, so what is waiting has to be counted by the side that counted
    // everything. A lower bound — it cannot see reviews that fall due during
    // the session, nor the learning cards the session makes for itself.
    remaining: {
      newCards: Math.max(0, scan.newCards - dealtFrom(newPool)),
      // Against the review pool rather than "everything not new", because the
      // queue's non-new entries include the learning cards, and `dueReviews`
      // does not count those.
      reviewCards: Math.max(0, scan.dueReviews - dealtFrom(reviewPool)),
    },
    nextDue: scan.nextDue?.toISOString() ?? null,
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
 *
 * Exported for `lib/db/practice.ts`, which chooses its cards by a different
 * rule but has to render them by the same one: a practice showing and a
 * review showing are the same card folded from the same log, and a second
 * hydration path would be a second answer to that.
 */
export async function hydrateQueue(
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

  return {
    applied,
    rejected,
    states,
    leeches: [...leeches],
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
