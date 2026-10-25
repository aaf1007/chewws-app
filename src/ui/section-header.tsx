import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './text';
import { spacing } from './theme';

/** A small uppercase muted heading over a group, e.g. "POPULAR DISHES". */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.row}>
      <Text variant="overline" tone="textMuted" accessibilityRole="header">
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={spacing.sm}
          onPress={action.onPress}>
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
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
});
