import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, hairline, spacing } from './theme';

/**
 * One line of a Shopping List: an optional check circle at its left, a name, muted detail lines
 * under it (each Recipe's amounts), and an optional action at its right such as "Remove". A checked
 * line is muted and struck through. The check and the action are labelled with the name ("Check
 * off: garlic", "Remove: garlic"), so each row's buttons can be told apart.
 */
export function ShoppingListRow({
  name,
  details = [],
  check,
  action,
}: {
  name: string;
  details?: readonly string[];
  check?: { checked: boolean; onPress: () => void };
  action?: { label: string; onPress: () => void };
}) {
  const checked = check?.checked ?? false;
  return (
    <View style={styles.row}>
      {check ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`${checked ? 'Uncheck' : 'Check off'}: ${name}`}
          accessibilityState={{ checked }}
          hitSlop={spacing.sm}
          onPress={check.onPress}
          style={({ pressed }) => pressed && styles.pressed}>
          <Icon
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            tone={checked ? 'accent' : 'textMuted'}
          />
        </Pressable>
      ) : null}
      <View style={styles.text}>
        <Text tone={checked ? 'textMuted' : 'text'} style={checked && styles.struck}>
          {name}
        </Text>
        {details.map((detail, index) => (
          <Text key={index} variant="caption" tone="textMuted">
            {detail}
          </Text>
        ))}
      </View>
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
  text: { flex: 1, gap: spacing.xxs },
  struck: { textDecorationLine: 'line-through' },
  pressed: { opacity: 0.6 },
});
