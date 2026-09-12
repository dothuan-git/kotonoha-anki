import { and, asc, eq, gte } from 'drizzle-orm';

import { db } from '@/lib/db';
import { listConfusions } from '@/lib/db/confusions';
import { getSettings } from '@/lib/db/queries';
import { cardStates, cards, reviewLogs, words } from '@/lib/db/schema';
import { startOfStudyDay } from '@/lib/fsrs/day';
import {
  FORECAST_DAYS,
  RETENTION_WEEKS,
  VOLUME_DAYS,
  bucketForecast,
  bucketMaturity,
  bucketRetention,
  bucketVolume,
  type StatLog,
  type StatsView,
} from '@/lib/stats';

/**
 * /stats, read straight off `review_logs`.
 *
 * The log is the source of truth, so three of the four charts need
 * nothing else — and because they read the log rather than `card_states`, they
 * stay right through a `npm run recompute` that moves every projected row.
 * Only the forecast needs the projection, because "when is this due" is
 * precisely what the projection is for.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildStats(now = new Date()): Promise<StatsView> {
  // One window covering both history charts: the volume chart wants 90 study
  // days, retention wants 26 weeks, so the wider of the two is read once and
  // bucketed twice rather than queried twice.
  const windowDays = Math.max(VOLUME_DAYS, RETENTION_WEEKS * 7);
  const since = new Date(startOfStudyDay(now).getTime() - (windowDays - 1) * DAY_MS);

  const [settings, logs, states, confusions, totals] = await Promise.all([
    getSettings(),
    selectLogsSince(since),
    selectActiveStates(),
    listConfusions(),
    selectTotals(),
  ]);

  const { overdue, forecast } = bucketForecast(states, now, FORECAST_DAYS);

  return {
    now: now.toISOString(),
    volume: bucketVolume(logs, now, VOLUME_DAYS),
    forecast,
    overdue,
    retention: bucketRetention(logs, now, RETENTION_WEEKS),
    requestRetention: settings.requestRetention,
    maturity: bucketMaturity(states),
    confusions,
    totals,
  };
}

/**
 * The log window, four columns of it.
 *
 * A full year at the daily cap is around 36k rows and this reads half of
 * that, all of it narrow. This is a single-user app meant to run for years
 * rather than to scale; if that ever stops being comfortable, the volume and
 * retention buckets are the two things to push into SQL, and the study-day
 * boundary (04:00, a fixed zone) is the only awkward part of doing so.
 */
function selectLogsSince(since: Date): Promise<StatLog[]> {
  return db
    .select({
      cardId: reviewLogs.cardId,
      rating: reviewLogs.rating,
      state: reviewLogs.state,
      reviewedAt: reviewLogs.reviewedAt,
    })
    .from(reviewLogs)
    .where(gte(reviewLogs.reviewedAt, since))
    .orderBy(asc(reviewLogs.reviewedAt));
}

/**
 * The projected state of every card that is actually in rotation — the same
 * filter `buildSession` applies, so the forecast counts what a session would
 * hand you rather than what is merely in the table. A leeched production
 * card and a suspended word are both out.
 */
function selectActiveStates(): Promise<{ due: Date; state: number; stability: number | null }[]> {
  return db
    .select({ due: cardStates.due, state: cardStates.state, stability: cardStates.stability })
    .from(cardStates)
    .innerJoin(cards, eq(cards.id, cardStates.cardId))
    .innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.active, true), eq(words.suspended, false)));
}

async function selectTotals(): Promise<StatsView['totals']> {
  const [ratings, cardsStudied, wordCount] = await Promise.all([
    db.$count(reviewLogs),
    db
      .selectDistinct({ cardId: reviewLogs.cardId })
      .from(reviewLogs)
      .then((rows) => rows.length),
    db.$count(words),
  ]);

  return { ratings: Number(ratings), cardsStudied, words: Number(wordCount) };
}
