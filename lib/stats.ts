import { STUDY_TIME_ZONE, startOfStudyDay } from '@/lib/fsrs/day';
import { State } from '@/lib/fsrs/replay';
import type { ConfusionPair } from '@/lib/confusion';

/**
 * The four /stats charts, as pure functions over rows.
 *
 * Everything here buckets by the **study day** (04:00 Asia/Ho_Chi_Minh),
 * not by the calendar day, because that is the day the caps are kept in. A
 * session that runs to half past midnight belongs to the day it started, and a
 * chart that put those reviews on the next column would disagree with the
 * "12/100 hôm nay" the reviewer showed while they were happening.
 *
 * Separate from `lib/db/stats.ts` on purpose: the bucketing is the part that
 * is easy to get subtly wrong, and it is the part worth testing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far each chart looks, and the shape /stats renders.
 *
 * Here rather than next to the queries in `lib/db/stats.ts`, because the
 * screen is a client component and needs both. Importing a value — even a
 * number — from a module that imports `lib/db` pulls the database client into
 * the browser bundle, where it throws on a missing DATABASE_URL before
 * anything renders. A type-only import would have been fine; a constant is
 * not, and the difference is invisible until it runs.
 */
export const VOLUME_DAYS = 90;
export const RETENTION_WEEKS = 26;
export const FORECAST_DAYS = 30;

/**
 * `2026-09-12` for the study day an instant falls in.
 *
 * Formatted in the study zone, not in UTC. A study day starts at 04:00 in
 * Ho Chi Minh City, which is 21:00 UTC on the *previous* calendar date — so
 * `toISOString()` on that instant would label every column a day early, and
 * would do it consistently enough to look right.
 */
const DAY_KEY = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function studyDayKey(at: Date): string {
  const parts = DAY_KEY.formatToParts(startOfStudyDay(at));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** The study days ending today, oldest first. */
export function studyDayRange(now: Date, days: number): string[] {
  const start = startOfStudyDay(now).getTime();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(studyDayKey(new Date(start - i * DAY_MS)));
  }
  return keys;
}

/**
 * The study days starting today, soonest first.
 *
 * Stepped from the *start* of each study day rather than by adding whole days
 * to `now`, so that the keys stay one per day across a DST shift in a zone
 * that has one. Asia/Ho_Chi_Minh does not, but `startOfStudyDay` takes a zone
 * and this should not be the line that assumes it never will.
 */
export function forwardStudyDays(now: Date, days: number): string[] {
  let cursor = startOfStudyDay(now);
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    keys.push(studyDayKey(cursor));
    cursor = startOfStudyDay(new Date(cursor.getTime() + DAY_MS + DAY_MS / 2));
  }
  return keys;
}

/** The slice of `review_logs` the charts read. `state` is the state *before* the review. */
export interface StatLog {
  cardId: string;
  rating: number;
  state: number;
  reviewedAt: Date;
}

export interface VolumeDay {
  day: string;
  /** Distinct cards seen for the first time ever that day. */
  newCards: number;
  /** Distinct cards seen that day that were not new. */
  reviewCards: number;
  /** Every rating written that day, learning-step repeats included. */
  ratings: number;
}

/**
 * Chart 1 — how much was studied, per day.
 *
 * Cards are counted the way the daily caps count them (`getCountedCards`): once per
 * day, in the bucket of their first showing. A new card walking `['1m','10m']`
 * writes three rows and is still one new card. `ratings` keeps the raw count
 * alongside, because the gap between them is the day's re-lapses and that is
 * worth being able to see.
 */
export function bucketVolume(logs: readonly StatLog[], now: Date, days: number): VolumeDay[] {
  const buckets = new Map<string, { cards: Map<string, boolean>; ratings: number }>();
  for (const key of studyDayRange(now, days)) {
    buckets.set(key, { cards: new Map(), ratings: 0 });
  }

  for (const log of logs) {
    const bucket = buckets.get(studyDayKey(log.reviewedAt));
    if (!bucket) continue;
    bucket.ratings++;
    // `bool_or(state = 0)` — a card whose first showing that day was its first
    // showing ever is a new card, whichever order the rows arrive in.
    bucket.cards.set(log.cardId, (bucket.cards.get(log.cardId) ?? false) || log.state === State.New);
  }

  return [...buckets].map(([day, bucket]) => {
    let newCards = 0;
    for (const wasNew of bucket.cards.values()) if (wasNew) newCards++;
    return {
      day,
      newCards,
      reviewCards: bucket.cards.size - newCards,
      ratings: bucket.ratings,
    };
  });
}

export interface ForecastDay {
  day: string;
  count: number;
}

/**
 * Chart 2 — what is coming.
 *
 * New cards are left out. Their `due` is the word's creation time (the fold
 * seeds from it), so every one of them is "overdue" by construction; what
 * actually releases them is the daily cap, not the clock. Putting them on a
 * forecast would say the next 300 days all happen tomorrow.
 */
export function bucketForecast(
  dues: readonly { due: Date; state: number }[],
  now: Date,
  days: number,
): { overdue: number; forecast: ForecastDay[] } {
  const keys = forwardStudyDays(now, days);
  const buckets = new Map<string, number>(keys.map((key) => [key, 0]));
  const today = studyDayKey(now);
  let overdue = 0;

  for (const row of dues) {
    if (row.state === State.New) continue;
    const key = studyDayKey(row.due);
    if (key < today) {
      overdue++;
      continue;
    }
    const current = buckets.get(key);
    if (current !== undefined) buckets.set(key, current + 1);
  }

  return { overdue, forecast: [...buckets].map(([day, count]) => ({ day, count })) };
}

export interface RetentionWeek {
  /** The study day the week starts on. */
  weekStart: string;
  reviews: number;
  recalled: number;
  /** `recalled / reviews`, or null for a week with nothing to divide by. */
  rate: number | null;
}

/**
 * Chart 3 — is it working.
 *
 * Retention is the share of reviews graded Được or Dễ, and it counts only
 * cards that were *already known*: a rating on a card in `State.New` is the
 * first time it has ever been seen, so grading it Quên says nothing about
 * recall. Including those would drag the line down by exactly the rate at
 * which new words are being added, which is a chart about the daily caps
 * rather than about memory.
 *
 * Weekly rather than daily because a day is 20–100 reviews and the noise
 * swamps the signal; the scheduler aims at `request_retention`, and the
 * question is whether the line sits near it.
 */
export function bucketRetention(
  logs: readonly StatLog[],
  now: Date,
  weeks: number,
): RetentionWeek[] {
  const days = studyDayRange(now, weeks * 7);
  const starts = days.filter((_, index) => index % 7 === 0);
  const weekOf = new Map<string, string>();
  days.forEach((day, index) => {
    const start = starts[Math.floor(index / 7)];
    if (start) weekOf.set(day, start);
  });

  const buckets = new Map<string, { reviews: number; recalled: number }>(
    starts.map((start) => [start, { reviews: 0, recalled: 0 }]),
  );

  for (const log of logs) {
    if (log.state === State.New) continue;
    const start = weekOf.get(studyDayKey(log.reviewedAt));
    const bucket = start ? buckets.get(start) : undefined;
    if (!bucket) continue;
    bucket.reviews++;
    if (log.rating >= 3) bucket.recalled++;
  }

  return [...buckets].map(([weekStart, bucket]) => ({
    weekStart,
    reviews: bucket.reviews,
    recalled: bucket.recalled,
    rate: bucket.reviews > 0 ? bucket.recalled / bucket.reviews : null,
  }));
}

/**
 * Chart 4's buckets, in order. Ordered, which is why the chart wears a
 * sequential ramp rather than four unrelated hues.
 *
 * The 21-day boundary is where a word stops being something you are learning
 * and starts being something you know — roughly four consecutive Được.
 */
export const MATURITY_BUCKETS = ['new', 'learning', 'young', 'mature', 'retired'] as const;
export type MaturityBucket = (typeof MATURITY_BUCKETS)[number];

export const MATURITY_LABELS: Record<MaturityBucket, string> = {
  new: 'Chưa học',
  learning: 'Đang học',
  young: 'Non (<21 ngày)',
  mature: 'Chín (21–90 ngày)',
  retired: 'Thuộc (≥90 ngày)',
};

export interface MaturitySlice {
  bucket: MaturityBucket;
  label: string;
  count: number;
}

/** Chart 4 — what the collection actually looks like right now. */
export function bucketMaturity(
  states: readonly { state: number; stability: number | null }[],
): MaturitySlice[] {
  const counts: Record<MaturityBucket, number> = {
    new: 0,
    learning: 0,
    young: 0,
    mature: 0,
    retired: 0,
  };

  for (const row of states) {
    counts[maturityOf(row)]++;
  }

  return MATURITY_BUCKETS.map((bucket) => ({
    bucket,
    label: MATURITY_LABELS[bucket],
    count: counts[bucket],
  }));
}

export function maturityOf(row: { state: number; stability: number | null }): MaturityBucket {
  if (row.state === State.New) return 'new';
  if (row.state === State.Learning || row.state === State.Relearning) return 'learning';
  const stability = row.stability ?? 0;
  if (stability < 21) return 'young';
  if (stability < 90) return 'mature';
  return 'retired';
}

/** How many days the heatmap draws — five rows of seven, as in the design. */
export const HEATMAP_DAYS = 35;

export interface Streak {
  /** Consecutive study days with at least one rating, ending today. */
  current: number;
  /** The longest such run anywhere in the window. */
  longest: number;
  /** Days in the window with nothing on them — the gaps, counted not hidden. */
  gaps: number;
}

/**
 * The streak, counted backwards from today.
 *
 * Today is allowed to be empty without breaking the run. The study day rolls
 * over at 04:00 and this screen is read in the morning, so a streak that
 * reset itself every day until the first review would be wrong far more often
 * than it was right — it would say 0 to someone on day fourteen. An empty
 * *yesterday* does break it; that is a missed day.
 *
 * Nothing here repairs a gap. The kintsugi framing in the design is about not
 * hiding the break — `gaps` is returned for exactly that reason — not about
 * pretending the run continued through it.
 */
export function computeStreak(volume: readonly VolumeDay[]): Streak {
  const active = volume.map((day) => day.ratings > 0);

  let current = 0;
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i]) {
      current++;
    } else if (i === active.length - 1) {
      // Today, still untouched: the run stands on yesterday.
      continue;
    } else {
      break;
    }
  }

  let longest = 0;
  let run = 0;
  let gaps = 0;
  for (const on of active) {
    if (on) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
      gaps++;
    }
  }

  return { current, longest, gaps };
}

export interface HeatCell {
  day: string;
  ratings: number;
  /** 0 for an empty day, then four steps of the bamboo ramp. */
  level: 0 | 1 | 2 | 3 | 4;
  /** An empty day with study on both sides of it — a break in a run, not a lead-in. */
  repaired: boolean;
}

/**
 * The heatmap, over the last `days` study days.
 *
 * The steps are quartiles of the busiest day in the window rather than fixed
 * counts. The prototype hardcoded 6 and 10, which were right for its mock
 * data and wrong for a real cap of 100 reviews a day — every cell would sit
 * at the top step and the map would be a solid green block.
 */
export function buildHeatmap(volume: readonly VolumeDay[], days = HEATMAP_DAYS): HeatCell[] {
  const window = volume.slice(-days);
  const peak = Math.max(0, ...window.map((day) => day.ratings));

  return window.map((day, i) => {
    let level: HeatCell['level'] = 0;
    if (day.ratings > 0 && peak > 0) {
      const share = day.ratings / peak;
      level = share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
    }

    const before = window.slice(0, i).some((d) => d.ratings > 0);
    const after = window.slice(i + 1).some((d) => d.ratings > 0);

    return {
      day: day.day,
      ratings: day.ratings,
      level,
      repaired: day.ratings === 0 && before && after,
    };
  });
}

/** Everything /stats renders. Assembled by `buildStats` in `lib/db/stats.ts`. */
export interface StatsView {
  now: string;
  volume: VolumeDay[];
  forecast: ForecastDay[];
  overdue: number;
  retention: RetentionWeek[];
  /** The scheduler's target, the line the retention chart is read against. */
  requestRetention: number;
  maturity: MaturitySlice[];
  confusions: ConfusionPair[];
  totals: {
    /** Every rating ever written. */
    ratings: number;
    /** Distinct cards reviewed at least once. */
    cardsStudied: number;
    words: number;
  };
}

/** `2026-09-12` → `12/09`, for an axis that has to fit thirty of them. */
export function formatDayLabel(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}
