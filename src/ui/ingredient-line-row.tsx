import { StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, hairline, radii, spacing } from './theme';

/** One ingredient line of a Recipe as written, with the plain Ingredient it's linked to and its amount. */
export function IngredientLineRow({
  text,
  ingredient,
  amount,
}: {
  text: string;
  ingredient: string;
  amount?: string | null;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${text}. Ingredient: ${ingredient}`}
      style={styles.row}>
      <Text>{text}</Text>
      <View style={styles.meta}>
        <View style={styles.pill}>
          <Icon name="link-outline" size="sm" tone="textMuted" />
          <Text variant="label">{ingredient}</Text>
        </View>
        {amount ? (
          <Text variant="caption" tone="textMuted">
            {amount}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
});
