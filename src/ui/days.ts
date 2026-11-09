// Calendar days as the app shows them. Plain functions with no React Native, so copy modules that
// use them can be tested in Node.

/** A calendar day as `YYYY-MM-DD`, with no time or zone. */
export type Day = string;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The day at noon UTC, so adding days never crosses a zone's clock change. */
const at = (day: Day) => new Date(`${day}T12:00:00Z`);
const dayOf = (date: Date): Day => date.toISOString().slice(0, 10);
export const plusDays = (day: Day, days: number): Day => dayOf(new Date(at(day).getTime() + days * 86_400_000));

/** Today on this phone, as a calendar day. */
export function localToday(now: Date = new Date()): Day {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A day as the app shows it: "Sat 2 Nov", with the year when it isn't `today`'s ("Sat 2 Nov 2027"). */
export function formatDay(day: Day, today: Day = localToday()): string {
  const date = at(day);
  const short = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
}

/** A day with its year, as the app writes a date: "2 Nov 2026" (day, month, year; no weekday). */
export function formatDate(day: Day): string {
  const date = at(day);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${day.slice(0, 4)}`;
}
