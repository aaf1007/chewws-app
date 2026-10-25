import { StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/**
 * A gray rounded notice that list changes haven't reached the server: a cloud with a slash while
 * offline, arrows while they're being sent. The message says what's waiting.
 */
export function SyncNotice({
  status,
  message,
  testID,
}: {
  status: 'offline' | 'syncing';
  message: string;
  testID?: string;
}) {
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={message} testID={testID} style={styles.notice}>
      <Icon name={status === 'offline' ? 'cloud-offline-outline' : 'sync-outline'} tone="textMuted" />
      <Text variant="caption" tone="textMuted" style={styles.message}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  message: { flex: 1 },
});
