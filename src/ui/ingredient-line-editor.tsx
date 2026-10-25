import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { TextField } from './text-field';
import { colors, radii, spacing } from './theme';

export type IngredientLineFields = {
  originalText: string;
  amountText: string;
  ingredientName: string;
};

/**
 * One ingredient line being written: the line as it reads in the Recipe, its amount, and the plain
 * Ingredient it's linked to. Fields are labelled and test-id'd by the line's number.
 */
export function IngredientLineEditor({
  number,
  value,
  onChange,
  onRemove,
}: {
  /** 1-based. */
  number: number;
  value: IngredientLineFields;
  onChange: (value: IngredientLineFields) => void;
  onRemove: () => void;
}) {
  const id = `line-${number}`;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text variant="overline" tone="textMuted">
          {`Line ${number}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove line ${number}`}
          hitSlop={spacing.sm}
          onPress={onRemove}>
          <Icon name="trash-outline" size="sm" tone="textMuted" />
        </Pressable>
      </View>
      <TextField
        label="As written"
        value={value.originalText}
        onChangeText={(originalText) => onChange({ ...value, originalText })}
        placeholder="e.g. 2 cloves garlic, minced"
        accessibilityLabel={`Line ${number}`}
        testID={`${id}-text`}
      />
      <View style={styles.pair}>
        <TextField
          label="Amount"
          value={value.amountText}
          onChangeText={(amountText) => onChange({ ...value, amountText })}
          placeholder="e.g. 2 cloves"
          accessibilityLabel={`Amount ${number}`}
          testID={`${id}-amount`}
        />
        <TextField
          label="Ingredient"
          value={value.ingredientName}
          onChangeText={(ingredientName) => onChange({ ...value, ingredientName })}
          placeholder="e.g. garlic"
          autoCapitalize="none"
          accessibilityLabel={`Ingredient ${number}`}
          testID={`${id}-ingredient`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pair: { flexDirection: 'row', gap: spacing.sm },
});
