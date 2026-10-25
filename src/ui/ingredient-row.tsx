import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, hairline, spacing } from './theme';

/**
 * One Ingredient a user has (in their Pantry, or a Staple), with an optional action at its right
 * such as "Used up". The action's accessibility label names the Ingredient ("Used up: garlic"), so
 * each row's button can be told apart.
 */
export function IngredientRow({
  name,
  action,
}: {
  name: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.name}>{name}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${action.label}: ${name}`}
          hitSlop={spacing.sm}
          onPress={action.onPress}
          style={({ pressed }) => pressed && styles.pressed}>
          <Text variant="label" tone="accent">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  name: { flex: 1 },
  pressed: { opacity: 0.6 },
});
