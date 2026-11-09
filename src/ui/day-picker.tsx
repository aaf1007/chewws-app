import { ListSwitcher } from './list-switcher';

/** A calendar day as `YYYY-MM-DD`, with no time or zone. */
type Day = string;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The day at noon UTC, so adding days never crosses a zone's clock change. */
const at = (day: Day) => new Date(`${day}T12:00:00Z`);
const dayOf = (date: Date): Day => date.toISOString().slice(0, 10);
const plusDays = (day: Day, days: number): Day => dayOf(new Date(at(day).getTime() + days * 86_400_000));

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

/**
 * Which day something is planned for, or none: pills for "No day", "Today", "Tomorrow" and the
 * next two weeks ("Sat 2 Nov"), scrolling sideways. A day already chosen outside them (a past one,
 * say) shows as its own pill after "No day". The chosen one is filled with the accent.
 */
export function DayPicker({
  value,
  onChange,
  today = localToday(),
  days = 14,
  testID,
}: {
  value: Day | null;
  onChange: (day: Day | null) => void;
  today?: Day;
  /** How many days from today to offer. */
  days?: number;
  testID?: string;
}) {
  const offered = Array.from({ length: days }, (_, i) => plusDays(today, i));
  const label = (day: Day, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDay(day, today));
  const options = [
    { value: 'none', label: 'No day' },
    ...(value !== null && !offered.includes(value) ? [{ value, label: formatDay(value, today) }] : []),
    ...offered.map((day, i) => ({ value: day, label: label(day, i) })),
  ];
  return (
    <ListSwitcher
      options={options}
      value={value ?? 'none'}
      onChange={(picked) => onChange(picked === 'none' ? null : picked)}
      testID={testID}
    />
  );
}
