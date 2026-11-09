import { SuggestedTagChip, TagChips } from './tag-chips';

/**
 * Who a Recipe was cooked with: each person a pill ("@sam"), filled with the accent and ticked
 * while chosen, outlined with a + while not. Tapping one switches it.
 */
export function CompanionPicker({
  people,
  chosen,
  onToggle,
}: {
  people: readonly { id: string; username: string }[];
  chosen: readonly string[];
  onToggle: (id: string) => void;
}) {
  return (
    <TagChips testID="companion-picker">
      {people.map((person) => (
        <SuggestedTagChip
          key={person.id}
          name={`@${person.username}`}
          selected={chosen.includes(person.id)}
          onPress={() => onToggle(person.id)}
        />
      ))}
    </TagChips>
  );
}
