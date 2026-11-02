import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from './button';
import { Icon } from './icon';
import { Text } from './text';
import { colors, hairline, radii, spacing } from './theme';

/**
 * One Recipe on a cooked plan's prompt: still to do, with the accent action that does it ("Log it",
 * "Use your copy", "Save your copy first"), or done, with a muted tick and what was done ("Logged").
 */
export type CookedPromptRecipe = {
  key: string;
  title: string;
  /** Whose it is: "Yours", "@sam's". */
  detail?: string;
} & ({ status: 'toDo'; action: string; onPress: () => void; testID?: string } | { status: 'done'; done: string });

/**
 * The prompt after "We cooked it" (decisions 18): a bordered card with an accent icon, a bold title
 * ("You cooked it!") and a muted message, then each of the plan's Recipes over a hairline with its
 * next step at its right, and "Not now" (plain) at the bottom. Each step's accessibility label names
 * the Recipe ("Save your copy first: Shakshuka").
 */
export function CookedPrompt({
  title,
  message,
  recipes,
  onDismiss,
  onOpen,
  testID,
}: {
  title: string;
  message?: string;
  recipes: readonly CookedPromptRecipe[];
  onDismiss: () => void;
  /** Opens what the prompt is about (the plan), from the title; left out on the plan itself. */
  onOpen?: () => void;
  testID?: string;
}) {
  const heading = (
    <View style={styles.heading}>
      <Icon name="restaurant-outline" tone="accent" />
      <View style={styles.headingText}>
        <Text variant="headline">{title}</Text>
        {message ? <Text tone="textMuted">{message}</Text> : null}
      </View>
      {onOpen ? <Icon name="chevron-forward" size="sm" tone="textMuted" /> : null}
    </View>
  );
  return (
    <View style={styles.card} testID={testID}>
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[title, message].filter(Boolean).join('. ')}
          onPress={onOpen}
          style={({ pressed }) => pressed && styles.pressed}>
          {heading}
        </Pressable>
      ) : (
        <View accessible accessibilityRole="text" accessibilityLabel={[title, message].filter(Boolean).join('. ')}>
          {heading}
        </View>
      )}
      <View>
        {recipes.map((recipe) => (
          <View key={recipe.key} style={styles.row}>
            <View style={styles.rowText}>
              <Text variant="headline" numberOfLines={2}>
                {recipe.title}
              </Text>
              {recipe.detail ? (
                <Text variant="caption" tone="textMuted">
                  {recipe.detail}
                </Text>
              ) : null}
            </View>
            {recipe.status === 'toDo' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${recipe.action}: ${recipe.title}`}
                hitSlop={spacing.sm}
                onPress={recipe.onPress}
                testID={recipe.testID}
                style={({ pressed }) => pressed && styles.pressed}>
                <Text variant="label" tone="accent">
                  {recipe.action}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.done} accessible accessibilityLabel={`${recipe.done}: ${recipe.title}`}>
                <Icon name="checkmark-circle" size="sm" tone="textMuted" />
                <Text variant="label" tone="textMuted">
                  {recipe.done}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
      <Button label="Not now" variant="plain" onPress={onDismiss} testID={testID ? `${testID}-not-now` : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headingText: { flex: 1, gap: spacing.xxs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  done: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pressed: { opacity: 0.6 },
});
