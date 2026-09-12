/**
 * The study day, for the daily caps.
 *
 * A day starts at 04:00 rather than midnight so a session that runs past
 * midnight keeps counting against the day it began — otherwise the caps
 * silently reset at 00:00 and hand out twelve more new cards.
 *
 * The zone is a constant, not a setting: this is a single-user app for one
 * particular person. Change these two values if that person moves.
 */
export const STUDY_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const DAY_START_HOUR = 4;

/** The instant the current study day began. */
export function startOfStudyDay(now: Date, timeZone = STUDY_TIME_ZONE): Date {
  const local = zonedParts(now, timeZone);
  const day = local.hour < DAY_START_HOUR ? addDays(local, -1) : local;
  return zonedToUtc(day.year, day.month, day.day, DAY_START_HOUR, timeZone);
}

/** The instant the next study day begins — what the "done for today" screen counts down to. */
export function startOfNextStudyDay(now: Date, timeZone = STUDY_TIME_ZONE): Date {
  const start = startOfStudyDay(now, timeZone);
  const local = zonedParts(start, timeZone);
  const next = addDays(local, 1);
  return zonedToUtc(next.year, next.month, next.day, DAY_START_HOUR, timeZone);
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function addDays(parts: Parts, days: number): Parts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * The UTC instant for a wall-clock time in `timeZone`. Reads the zone's offset
 * at the approximate instant and subtracts it; exact for a fixed-offset zone
 * like Asia/Ho_Chi_Minh, and off only within a DST transition hour elsewhere.
 */
function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}
