import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/** A wrapping row of Tag chips. */
export function TagChips({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={styles.row} testID={testID}>
      {children}
    </View>
  );
}

/** A Tag on a Recipe: its name in a gray pill, with a × that takes it off ("Remove Italian"). */
export function TagChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <View style={[styles.chip, styles.onRecipe]}>
      <Text variant="label" numberOfLines={1} style={styles.name}>
        {name}
      </Text>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={spacing.sm}
          onPress={onRemove}
          style={({ pressed }) => pressed && styles.pressed}>
          <Icon name="close" size="sm" tone="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A Tag suggested for a Draft, or one the user added there: filled with the accent and ticked while
 * it's kept, outlined while it's left out. Tapping it switches.
 */
export function SuggestedTagChip({
  name,
  selected,
  onPress,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  const tone = selected ? 'onAccent' : 'textMuted';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : styles.unselected,
        pressed && styles.pressed,
      ]}>
      <Icon name={selected ? 'checkmark' : 'add'} size="sm" tone={tone} />
      <Text variant="label" tone={tone} numberOfLines={1} style={styles.name}>
        {name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 32,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  name: { flexShrink: 1 },
  onRecipe: { backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  unselected: { backgroundColor: colors.surface, borderColor: colors.border },
  pressed: { opacity: 0.6 },
});
