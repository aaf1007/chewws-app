import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, floatingShadow, radii, spacing } from './theme';

export type SegmentOption<T extends string> = { value: T; label: string };

/**
 * A white pill of segments that floats at the bottom centre of its parent, e.g. "List | Map".
 * The parent must be the area it floats over (it positions itself absolutely).
 */
export function FloatingSegment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.anchor}>
      <View style={styles.pill} accessibilityRole="tablist">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[styles.segment, selected && styles.selected]}>
              <Text variant="label" tone={selected ? 'onAccent' : 'text'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.lg,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    padding: spacing.xs,
    gap: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    ...floatingShadow,
  },
  segment: {
    minWidth: 72,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  selected: { backgroundColor: colors.accent },
});
