import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

export type FilterTileOption<T extends string> = { value: T; label: string; icon: IconName };

/** A row of exactly three equal tiles, icon above label. The selected tile is filled with the accent. */
export function FilterTiles<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly [FilterTileOption<T>, FilterTileOption<T>, FilterTileOption<T>];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        const tone = selected ? 'onAccent' : 'text';
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.tile,
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}>
            <Icon name={option.icon} tone={tone} />
            <Text variant="label" tone={tone} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { backgroundColor: colors.surfaceMuted },
});
