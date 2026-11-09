import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/**
 * Where a Recipe was saved from: a video (its portrait thumbnail, the platform and creator, and a
 * line such as "Watch on TikTok") or a web page (`kind="page"`: a square picture, the site and the
 * page). With `onPress` it opens the source. Without a picture (not read yet, or one that won't
 * load) it shows a placeholder.
 */
export function SourceVideoCard({
  platform,
  title,
  detail,
  thumbnailUrl,
  kind = 'video',
  onPress,
  onThumbnailError,
  testID,
}: {
  /** The platform's name, e.g. "TikTok", or a web page's site, e.g. "cooking.example.com". */
  platform: string;
  /** The creator, or what the source is when the creator isn't known ("TikTok video", a page title). */
  title: string;
  /** A muted line under the title: "Watch on TikTok", or the link itself. */
  detail?: string;
  thumbnailUrl?: string | null;
  kind?: 'video' | 'page';
  onPress?: () => void;
  /** Called when the thumbnail fails to load (a platform link that has expired, say). */
  onThumbnailError?: () => void;
  /**
   * Names the card by its picture, as the card is one accessibility element: `{testID}-thumbnail`
   * once the picture has loaded, `{testID}-placeholder` without one, `{testID}` while it loads.
   */
  testID?: string;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const label = [platform, title, detail].filter(Boolean).join(', ');
  const thumbStyle = [styles.thumb, kind === 'page' && styles.pageThumb];
  const picture = !thumbnailUrl ? 'placeholder' : loaded === thumbnailUrl ? 'thumbnail' : null;
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      testID={testID && (picture ? `${testID}-${picture}` : testID)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={thumbStyle}
          onLoad={() => setLoaded(thumbnailUrl)}
          onError={onThumbnailError}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[thumbStyle, styles.placeholder]}>
          <Icon name={kind === 'page' ? 'globe-outline' : 'videocam-outline'} size="lg" tone="textMuted" />
        </View>
      )}
      <View style={styles.body}>
        <Text variant="overline" tone="textMuted" numberOfLines={1}>
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
  pageThumb: { height: THUMB_WIDTH },
  placeholder: { backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: spacing.xxs },
});
