import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/** One band to pick: "Liked", its Score range "6.7–10" and an icon. */
export type BandOption<T extends string> = { value: T; label: string; range: string; icon: IconName };

/**
 * How a Recipe was, as the first step of ranking it: a stack of bordered rows, each an accent
 * icon, the band in bold, its Score range muted, and a chevron. Picking one moves on.
 */
export function BandPicker<T extends string>({
  bands,
  onPick,
  disabled = false,
}: {
  bands: readonly BandOption<T>[];
  onPick: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.list}>
      {bands.map((band) => (
        <Pressable
          key={band.value}
          accessibilityRole="button"
          accessibilityLabel={band.label}
          accessibilityHint={`Scores ${band.range}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onPick(band.value)}
          testID={`band-${band.value}`}
          style={({ pressed }) => [styles.row, (pressed || disabled) && styles.pressed]}>
          <Icon name={band.icon} size="lg" tone="accent" />
          <View style={styles.body}>
            <Text variant="headline">{band.label}</Text>
            <Text variant="caption" tone="textMuted">
              {band.range}
            </Text>
          </View>
          <Icon name="chevron-forward" tone="textMuted" />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  body: { flex: 1, gap: spacing.xxs },
});
