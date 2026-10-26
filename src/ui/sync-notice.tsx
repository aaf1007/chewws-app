import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Text } from './text';
import { colors, radii, spacing, type ColorRole } from './theme';

export type SyncNoticeStatus = 'offline' | 'syncing' | 'retrying' | 'notSaved';

const ICON: Record<SyncNoticeStatus, { name: IconName; tone: ColorRole }> = {
  offline: { name: 'cloud-offline-outline', tone: 'textMuted' },
  syncing: { name: 'sync-outline', tone: 'textMuted' },
  retrying: { name: 'time-outline', tone: 'textMuted' },
  notSaved: { name: 'alert-circle-outline', tone: 'danger' },
};

/**
 * A gray rounded notice about list changes and the server: a cloud with a slash while they wait
 * offline, arrows while they're being sent, a clock while they wait to be tried again after a
 * server error, a warning when one couldn't be saved. The message says
 * which. `action` adds a small button, such as "OK" to dismiss it.
 */
export function SyncNotice({
  status,
  message,
  action,
  testID,
}: {
  status: SyncNoticeStatus;
  message: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
}) {
  const icon = ICON[status];
  return (
    <View
      accessible={!action}
      accessibilityRole={action ? undefined : 'text'}
      accessibilityLabel={action ? undefined : message}
      testID={testID}
      style={styles.notice}>
      <Icon name={icon.name} tone={icon.tone} />
      <Text variant="caption" tone="textMuted" style={styles.message}>
        {message}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={spacing.sm}>
          <Text variant="caption" tone="accent">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
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
