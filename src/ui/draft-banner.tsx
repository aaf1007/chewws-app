import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Text } from './text';
import { colors, radii, spacing, type ColorRole } from './theme';

/** What a Draft banner says: still being built, built without a recipe, or a failed build. */
export type DraftBannerKind = 'building' | 'notInCaption' | 'failed';

const ICON: Record<DraftBannerKind, { name: IconName; tone: ColorRole }> = {
  building: { name: 'hourglass-outline', tone: 'textMuted' },
  notInCaption: { name: 'document-text-outline', tone: 'accent' },
  failed: { name: 'alert-circle-outline', tone: 'danger' },
};

/**
 * A gray rounded banner at the top of a Draft, or under it in the Drafts list: an icon, a bold
 * title ("Recipe not in caption"), a muted message, and optional small actions ("Try again").
 */
export function DraftBanner({
  kind,
  title,
  message,
  actions = [],
  testID,
}: {
  kind: DraftBannerKind;
  title: string;
  message?: string;
  actions?: readonly { label: string; onPress: () => void }[];
  testID?: string;
}) {
  const icon = ICON[kind];
  return (
    <View style={styles.banner} testID={testID}>
      <Icon name={icon.name} tone={icon.tone} />
      <View style={styles.body}>
        <View accessible accessibilityRole="text" accessibilityLabel={[title, message].filter(Boolean).join('. ')}>
          <Text variant="label">{title}</Text>
          {message ? (
            <Text variant="caption" tone="textMuted">
              {message}
            </Text>
          ) : null}
        </View>
        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                hitSlop={spacing.sm}
                onPress={action.onPress}>
                <Text variant="label" tone="accent">
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  body: { flex: 1, gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.lg },
});
