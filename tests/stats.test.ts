import { describe, expect, it } from 'vitest';

import { State } from '@/lib/fsrs/replay';
import {
  bucketForecast,
  bucketMaturity,
  bucketRetention,
  bucketVolume,
  buildHeatmap,
  computeStreak,
  forwardStudyDays,
  studyDayKey,
  studyDayRange,
  type StatLog,
  type VolumeDay,
} from '@/lib/stats';

/**
 * The /stats charts, and the one thing about them that can actually be
 * wrong: which day a review lands on.
 *
 * The study day starts at 04:00 Asia/Ho_Chi_Minh, which is 21:00 UTC the
 * previous day. Every timestamp below is written in UTC so the boundary is
 * visible rather than implied.
 */

/** The instant a given study day begins — 04:00 in Ho Chi Minh City, as UTC. */
function dayStart(studyDay: string): string {
  const date = new Date(`${studyDay}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.toISOString().slice(0, 10)}T21:00:00.000Z`;
}

function log(reviewedAt: string, over: Partial<StatLog> = {}): StatLog {
  return {
    cardId: 'card-a',
    rating: 3,
    state: State.Review,
    reviewedAt: new Date(reviewedAt),
    ...over,
  };
}

const NOON = new Date('2026-09-12T05:00:00.000Z'); // 12:00 in Ho Chi Minh City

describe('studyDayKey', () => {
  it('puts a review just after 04:00 on the day that is starting', () => {
    expect(studyDayKey(new Date(dayStart('2026-09-12')))).toBe('2026-09-12');
    expect(studyDayKey(new Date('2026-09-11T21:00:01.000Z'))).toBe('2026-09-12');
  });

  it('labels the day in the study zone, not in UTC', () => {
    // 04:00 in Ho Chi Minh City is 21:00 UTC on the previous date, so a key
    // taken off the instant's UTC date would be a day early — consistently
    // enough to look right on the chart.
    expect(studyDayKey(new Date('2026-09-11T22:00:00.000Z'))).toBe('2026-09-12');
  });

  it('keeps a session that ran past midnight on the day it began', () => {
    // 00:30 on the 13th in Ho Chi Minh City — still the 12th's study day.
    expect(studyDayKey(new Date('2026-09-12T17:30:00.000Z'))).toBe('2026-09-12');
    // 03:59, the last minute of it.
    expect(studyDayKey(new Date('2026-09-12T20:59:00.000Z'))).toBe('2026-09-12');
    // 04:00, and the day has rolled.
    expect(studyDayKey(new Date('2026-09-12T21:00:00.000Z'))).toBe('2026-09-13');
  });
});

describe('studyDayRange', () => {
  it('ends on today and runs oldest first', () => {
    expect(studyDayRange(NOON, 3)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
  });

  it('is stable at either end of the study day', () => {
    const justAfterRollover = new Date('2026-09-12T21:00:30.000Z');
    expect(studyDayRange(justAfterRollover, 2)).toEqual(['2026-09-12', '2026-09-13']);
  });
});

describe('forwardStudyDays', () => {
  it('starts on today and runs soonest first', () => {
    expect(forwardStudyDays(NOON, 3)).toEqual(['2026-09-12', '2026-09-13', '2026-09-14']);
  });

  it('produces one key per day with no repeats or gaps', () => {
    const days = forwardStudyDays(NOON, 40);
    expect(new Set(days).size).toBe(40);
    expect(days[39]).toBe('2026-10-21');
  });
});

describe('bucketVolume', () => {
  it('counts a card once a day however many times it came round', () => {
    const day = bucketVolume(
      [
        log('2026-09-12T05:00:00.000Z', { state: State.New }),
        log('2026-09-12T05:01:00.000Z', { state: State.Learning }),
        log('2026-09-12T05:11:00.000Z', { state: State.Learning }),
      ],
      NOON,
      1,
    )[0];

    // One new card, three ratings — a new card walking ['1m', '10m'] must not
    // also spend a review slot, which is how the daily caps count it.
    expect(day).toEqual({ day: '2026-09-12', newCards: 1, reviewCards: 0, ratings: 3 });
  });

  it('calls a card new on the day of its first ever showing, whatever order the rows arrive in', () => {
    const [day] = bucketVolume(
      [
        log('2026-09-12T05:10:00.000Z', { state: State.Learning }),
        log('2026-09-12T05:00:00.000Z', { state: State.New }),
      ],
      NOON,
      1,
    );
    expect(day?.newCards).toBe(1);
    expect(day?.reviewCards).toBe(0);
  });

  it('separates two cards in the same day into their own buckets', () => {
    const [day] = bucketVolume(
      [
        log('2026-09-12T05:00:00.000Z', { cardId: 'a', state: State.New }),
        log('2026-09-12T05:02:00.000Z', { cardId: 'b', state: State.Review }),
      ],
      NOON,
      1,
    );
    expect(day).toEqual({ day: '2026-09-12', newCards: 1, reviewCards: 1, ratings: 2 });
  });

  it('emits an empty column for a day with nothing in it', () => {
    const days = bucketVolume([log('2026-09-12T05:00:00.000Z')], NOON, 3);
    expect(days.map((d) => d.ratings)).toEqual([0, 0, 1]);
  });

  it('drops a review older than the window rather than folding it into the first column', () => {
    const days = bucketVolume([log('2026-01-01T05:00:00.000Z')], NOON, 3);
    expect(days.every((d) => d.ratings === 0)).toBe(true);
  });
});

describe('bucketForecast', () => {
  const due = (at: string, state = State.Review) => ({ due: new Date(at), state });

  it('leaves new cards out entirely', () => {
    // A new card's due is the word's creation time (the fold seeds from
    // it), so it is "overdue" by construction; what releases it is the
    // daily cap, not the clock.
    const result = bucketForecast([due('2020-01-01T00:00:00.000Z', State.New)], NOON, 7);
    expect(result.overdue).toBe(0);
    expect(result.forecast.every((day) => day.count === 0)).toBe(true);
  });

  it('counts anything due before today as overdue rather than dropping it', () => {
    const result = bucketForecast([due('2026-09-01T05:00:00.000Z')], NOON, 7);
    expect(result.overdue).toBe(1);
  });

  it('puts a card due later today in the first column', () => {
    const result = bucketForecast([due('2026-09-12T15:00:00.000Z')], NOON, 7);
    expect(result.overdue).toBe(0);
    expect(result.forecast[0]).toEqual({ day: '2026-09-12', count: 1 });
  });

  it('ignores a card due beyond the horizon', () => {
    const result = bucketForecast([due('2027-01-01T05:00:00.000Z')], NOON, 7);
    expect(result.overdue).toBe(0);
    expect(result.forecast.reduce((sum, day) => sum + day.count, 0)).toBe(0);
  });
});

describe('bucketRetention', () => {
  it('ignores the first ever showing of a card', () => {
    // Rating a card you have never seen says nothing about recall; counting it
    // would drag the line down at the rate new words are added.
    const [week] = bucketRetention(
      [
        log('2026-09-12T05:00:00.000Z', { state: State.New, rating: 1 }),
        log('2026-09-12T05:01:00.000Z', { state: State.Review, rating: 3 }),
      ],
      NOON,
      1,
    );
    expect(week).toMatchObject({ reviews: 1, recalled: 1, rate: 1 });
  });

  it('counts Được and Dễ as recalled and nothing else', () => {
    const [week] = bucketRetention(
      [1, 2, 3, 4].map((rating) => log('2026-09-12T05:00:00.000Z', { rating })),
      NOON,
      1,
    );
    expect(week).toMatchObject({ reviews: 4, recalled: 2, rate: 0.5 });
  });

  it('reports a week with no reviews as null rather than as zero', () => {
    const weeks = bucketRetention([log('2026-09-12T05:00:00.000Z')], NOON, 2);
    expect(weeks[0]?.rate).toBeNull();
    expect(weeks[1]?.rate).toBe(1);
  });

  it('groups seven study days into one week', () => {
    const weeks = bucketRetention(
      studyDayRange(NOON, 7).map((day) => log(dayStart(day))),
      NOON,
      1,
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.reviews).toBe(7);
  });
});

describe('bucketMaturity', () => {
  it('splits Review cards at the 21-day line and again at 90', () => {
    const slices = bucketMaturity([
      { state: State.New, stability: null },
      { state: State.Learning, stability: 0.4 },
      { state: State.Relearning, stability: 3 },
      { state: State.Review, stability: 20.9 },
      { state: State.Review, stability: 21 },
      { state: State.Review, stability: 89.9 },
      { state: State.Review, stability: 365 },
    ]);

    expect(slices.map((s) => [s.bucket, s.count])).toEqual([
      ['new', 1],
      ['learning', 2],
      ['young', 1],
      ['mature', 2],
      ['retired', 1],
    ]);
  });

  it('returns every bucket even when the collection is empty', () => {
    expect(bucketMaturity([]).map((s) => s.count)).toEqual([0, 0, 0, 0, 0]);
  });
});

/** A volume window from a run of daily rating counts, oldest first. */
function volume(ratings: readonly number[]): VolumeDay[] {
  return ratings.map((count, i) => ({
    day: `2026-01-${String(i + 1).padStart(2, '0')}`,
    newCards: 0,
    reviewCards: 0,
    ratings: count,
  }));
}

describe('computeStreak', () => {
  it('counts back from today', () => {
    expect(computeStreak(volume([0, 1, 1, 1])).current).toBe(3);
  });

  it('lets an untouched today stand on yesterday', () => {
    // 04:00 rollover: the streak must not read 0 all morning.
    expect(computeStreak(volume([1, 1, 1, 0])).current).toBe(3);
  });

  it('breaks on a missed yesterday', () => {
    expect(computeStreak(volume([1, 1, 1, 0, 0])).current).toBe(0);
  });

  it('keeps the longest run after a gap resets the current one', () => {
    const streak = computeStreak(volume([1, 1, 1, 1, 0, 1]));
    expect(streak).toMatchObject({ current: 1, longest: 4, gaps: 1 });
  });

  it('is all zeros for a window with nothing in it', () => {
    expect(computeStreak(volume([0, 0, 0]))).toEqual({ current: 0, longest: 0, gaps: 3 });
  });
});

describe('buildHeatmap', () => {
  it('scales the steps to the busiest day rather than to fixed counts', () => {
    // Against a peak of 100 these are 10%, 50% and 100% — one step each,
    // where the prototype's hardcoded 6/10 thresholds would flatten all three
    // onto the top step.
    const cells = buildHeatmap(volume([10, 50, 100]), 3);
    expect(cells.map((c) => c.level)).toEqual([1, 2, 4]);
  });

  it('gives an empty day level 0', () => {
    expect(buildHeatmap(volume([0, 5]), 2)[0]?.level).toBe(0);
  });

  it('marks an empty day between two studied days as repaired', () => {
    const cells = buildHeatmap(volume([3, 0, 3]), 3);
    expect(cells.map((c) => c.repaired)).toEqual([false, true, false]);
  });

  it('does not mark leading or trailing empty days as repaired', () => {
    const cells = buildHeatmap(volume([0, 3, 0]), 3);
    expect(cells.map((c) => c.repaired)).toEqual([false, false, false]);
  });

  it('takes the last N days and survives an all-empty window', () => {
    const cells = buildHeatmap(volume([1, 2, 3, 4, 5]), 2);
    expect(cells.map((c) => c.ratings)).toEqual([4, 5]);
    expect(buildHeatmap(volume([0, 0]), 2).every((c) => c.level === 0)).toBe(true);
  });
});
