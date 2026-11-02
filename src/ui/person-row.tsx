import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, hairline, radii, spacing } from './theme';

/** An action at a person row's right: `accent` for the one that moves things on, `muted` for the other. */
export type PersonAction = { label: string; onPress: () => void; tone?: 'accent' | 'muted' };

/**
 * Another user, by username: a round initial, "@sam", a muted detail line ("Wants to be Friends"),
 * and up to two actions at the right ("Accept", "Decline"). Each action's accessibility label names
 * the person ("Accept: @sam"), so each row's buttons can be told apart. With `onPress`, the person
 * (initial, name and detail) is one button that opens them, with a chevron before the actions.
 */
export function PersonRow({
  username,
  detail,
  actions = [],
  onPress,
  testID,
}: {
  username: string;
  detail?: string;
  actions?: readonly PersonAction[];
  onPress?: () => void;
  testID?: string;
}) {
  const handle = `@${username}`;
  return (
    <View style={styles.row}>
      <Pressable
        accessible={onPress !== undefined}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? [handle, detail].filter(Boolean).join(', ') : undefined}
        disabled={!onPress}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
        <View style={styles.initial} accessible={false} importantForAccessibility="no-hide-descendants">
          <Text variant="headline" tone="textMuted">
            {username.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.text}>
          <Text variant="headline" numberOfLines={1}>
            {handle}
          </Text>
          {detail ? (
            <Text variant="caption" tone="textMuted" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        {onPress ? <Icon name="chevron-forward" tone="textMuted" /> : null}
      </Pressable>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={`${action.label}: ${handle}`}
          hitSlop={spacing.sm}
          onPress={action.onPress}
          style={({ pressed }) => pressed && styles.pressed}>
          <Text variant="label" tone={action.tone === 'muted' ? 'textMuted' : 'accent'}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  initial: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.6 },
});
