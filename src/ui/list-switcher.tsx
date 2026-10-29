import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text } from './text';
import { colors, radii, spacing } from './theme';

export type ListSwitcherOption<T extends string> = { value: T; label: string };

/**
 * Which list a screen shows, as a row of pills that scrolls sideways when there are many ("Your
 * list", "Sam's list"). The selected pill is filled with the accent, the rest are outlined.
 */
export function ListSwitcher<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: readonly ListSwitcherOption<T>[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      testID={testID}
      contentContainerStyle={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.pill, selected && styles.selected, pressed && !selected && styles.pressed]}>
            <Text variant="label" tone={selected ? 'onAccent' : 'text'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  pill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { backgroundColor: colors.surfaceMuted },
});
