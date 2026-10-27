import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { Icon } from './icon';
import { ScoreBadge, formatScore, type ScoreTone } from './score-badge';
import { Text } from './text';
import { colors, hairline, radii, spacing } from './theme';

const THUMB = 56;

export function ListRow({
  title,
  titleSuffix,
  meta = [],
  photo,
  score,
  scoreTone = 'mine',
  onPress,
  onMore,
}: {
  title: string;
  /** Small muted text after the title, e.g. a cook time. */
  titleSuffix?: string;
  /** One or two muted lines under the title. */
  meta?: readonly string[];
  /** The thumbnail. Without one the row shows a placeholder. */
  photo?: ImageSourcePropType;
  /** A 0–10 Score, drawn as a badge over the thumbnail's bottom-left corner. */
  score?: number;
  scoreTone?: ScoreTone;
  onPress?: () => void;
  /** Shows the vertical "more" button at the right. */
  onMore?: () => void;
}) {
  const lines = meta.slice(0, 2);
  // One accessibility element for the row's content; the "more" button stays a separate one.
  const label = [
    title,
    titleSuffix,
    score === undefined ? undefined : `Score ${formatScore(score)}`,
    ...lines,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.row}>
      <Pressable
        accessible
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={label}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <View style={styles.thumbWrap}>
          {photo ? (
            <Image source={photo} style={styles.thumb} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.thumb, styles.placeholder]}>
              <Icon name="restaurant-outline" size="lg" tone="textMuted" />
            </View>
          )}
          {score !== undefined ? (
            <View style={styles.badge}>
              <ScoreBadge score={score} tone={scoreTone} size="sm" />
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <Text variant="headline" numberOfLines={1}>
            {title}
            {titleSuffix ? (
              <Text variant="caption" tone="textMuted">
                {`  ${titleSuffix}`}
              </Text>
            ) : null}
          </Text>
          {lines.map((line) => (
            <Text key={line} variant="caption" tone="textMuted" numberOfLines={1}>
              {line}
            </Text>
          ))}
        </View>
      </Pressable>

      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More for ${title}`}
          hitSlop={spacing.md}
          onPress={onMore}
          style={styles.more}>
          <Icon name="ellipsis-vertical" tone="textMuted" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.7 },
  thumbWrap: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: radii.md },
  placeholder: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', left: -spacing.sm, bottom: -spacing.sm },
  body: { flex: 1, gap: spacing.xxs },
  more: { paddingVertical: spacing.sm, paddingLeft: spacing.xs },
});
