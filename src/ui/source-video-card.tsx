import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/**
 * The video a Recipe was saved from: its thumbnail (portrait, as short videos are), the platform
 * and creator, and a line such as "Watch on TikTok". With `onPress` it opens the video. Without a
 * thumbnail (not read yet) it shows a placeholder.
 */
export function SourceVideoCard({
  platform,
  title,
  detail,
  thumbnailUrl,
  onPress,
  testID,
}: {
  /** The platform's name, e.g. "TikTok". */
  platform: string;
  /** The creator, or what the video is when the creator isn't known yet ("TikTok video"). */
  title: string;
  /** A muted line under the title: "Watch on TikTok", or the link itself. */
  detail?: string;
  thumbnailUrl?: string | null;
  onPress?: () => void;
  testID?: string;
}) {
  const label = [platform, title, detail].filter(Boolean).join(', ');
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {thumbnailUrl ? (
        <Image source={{ uri: thumbnailUrl }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.placeholder]}>
          <Icon name="videocam-outline" size="lg" tone="textMuted" />
        </View>
      )}
      <View style={styles.body}>
        <Text variant="overline" tone="textMuted">
          {platform}
        </Text>
        <Text variant="headline" numberOfLines={2}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" tone={onPress ? 'accent' : 'textMuted'} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon name="open-outline" tone="textMuted" /> : null}
    </Pressable>
  );
}

const THUMB_WIDTH = 72;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: THUMB_WIDTH, height: (THUMB_WIDTH * 4) / 3, borderRadius: radii.sm },
  placeholder: { backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: spacing.xxs },
});
