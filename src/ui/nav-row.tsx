import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Text } from './text';
import { colors, hairline, spacing } from './theme';

/** A row that opens another screen: an icon, a label ("Drafts (2)"), a muted detail and a chevron. */
export function NavRow({
  icon,
  label,
  detail,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Icon name={icon} tone="accent" />
      <View style={styles.body}>
        <Text variant="headline">{label}</Text>
        {detail ? (
          <Text variant="caption" tone="textMuted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" tone="textMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1, gap: spacing.xxs },
});
