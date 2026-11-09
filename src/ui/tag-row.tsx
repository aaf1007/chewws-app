import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, hairline, radii, spacing } from './theme';

/**
 * One of the user's Tags in their Tags list: a round gray tag icon, the name in bold, a muted
 * detail ("2 Recipes"), and a red "Delete" at the right. The name and detail read as one element
 * ("Italian, 2 Recipes"); the action's accessibility label names the Tag ("Delete: Italian").
 */
export function TagRow({
  name,
  detail,
  onDelete,
  testID,
}: {
  name: string;
  detail?: string;
  onDelete?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <View
        accessible
        accessibilityLabel={[name, detail].filter(Boolean).join(', ')}
        testID={testID}
        style={styles.tag}>
        <View style={styles.icon}>
          <Icon name="pricetag-outline" tone="textMuted" />
        </View>
        <View style={styles.text}>
          <Text variant="headline" numberOfLines={1}>
            {name}
          </Text>
          {detail ? (
            <Text variant="caption" tone="textMuted" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete: ${name}`}
          hitSlop={spacing.sm}
          onPress={onDelete}
          style={({ pressed }) => pressed && styles.pressed}>
          <Text variant="label" tone="danger">
            Delete
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
    minHeight: 60,
    paddingVertical: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  tag: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
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
