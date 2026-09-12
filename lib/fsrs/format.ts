const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * A scheduling gap as the rating buttons show it: "10 phút", "2 ngày",
 * "4 tháng". Rounded, never precise — it is a hint about which button is
 * which, not a promise.
 */
export function formatInterval(ms: number): string {
  const abs = Math.max(0, ms);
  if (abs < MINUTE) return '<1 phút';
  if (abs < HOUR) return `${Math.round(abs / MINUTE)} phút`;
  if (abs < DAY) return `${Math.round(abs / HOUR)} giờ`;
  if (abs < MONTH) return `${Math.round(abs / DAY)} ngày`;
  if (abs < YEAR) return `${Math.round(abs / MONTH)} tháng`;
  return `${round1(abs / YEAR)} năm`;
}

/** "còn 3 ngày" / "quá hạn 2 ngày" / "đến hạn" for a due date relative to now. */
export function formatDueIn(now: Date, due: Date): string {
  const delta = due.getTime() - now.getTime();
  if (Math.abs(delta) < MINUTE) return 'đến hạn';
  return delta > 0 ? `còn ${formatInterval(delta)}` : `quá hạn ${formatInterval(-delta)}`;
}

function round1(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}
