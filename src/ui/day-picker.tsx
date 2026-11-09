import { type Day, formatDay, localToday, plusDays } from './days';
import { ListSwitcher } from './list-switcher';

/**
 * Which day something is planned for, or none: pills for "No day", "Today", "Tomorrow" and the
 * next two weeks ("Sat 2 Nov"), scrolling sideways. A day already chosen outside them (a past one,
 * say) shows as its own pill after "No day". The chosen one is filled with the accent.
 *
 * `range="past"`, for a day something happened (a Cook Log's): "Today", "Yesterday" and the days
 * before, newest first, and no "No day".
 */
export function DayPicker({
  value,
  onChange,
  today = localToday(),
  days = 14,
  range = 'next',
  testID,
}: {
  value: Day | null;
  onChange: (day: Day | null) => void;
  today?: Day;
  /** How many days from today to offer. */
  days?: number;
  range?: 'next' | 'past';
  testID?: string;
}) {
  const step = range === 'past' ? -1 : 1;
  const offered = Array.from({ length: days }, (_, i) => plusDays(today, i * step));
  const near = range === 'past' ? 'Yesterday' : 'Tomorrow';
  const label = (day: Day, i: number) => (i === 0 ? 'Today' : i === 1 ? near : formatDay(day, today));
  const options = [
    ...(range === 'next' ? [{ value: 'none', label: 'No day' }] : []),
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
