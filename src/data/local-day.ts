/** The calendar day `days` after `now`'s on this phone, as `YYYY-MM-DD`. */
export function localDay(now: number, days = 0): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
