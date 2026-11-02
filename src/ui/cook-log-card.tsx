import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { PhotoStrip, type StripPhoto } from './photo-strip';
import { Text } from './text';
import { colors, hairline, spacing } from './theme';

/**
 * One time a Recipe was cooked, as a row in its list of Cook Logs: the day in bold ("Sat 2 Nov"),
 * who it was cooked with ("with @sam, @jo"), the notes and the photos. Pressing it opens the log.
 */
export function CookLogCard({
  day,
  companions,
  notes,
  photos,
  onPress,
  testID,
}: {
  /** The day as the app writes it (`formatDay`). */
  day: string;
  /** Usernames, without the @. */
  companions: readonly string[];
  notes: string | null;
  photos: readonly StripPhoto[];
  onPress?: () => void;
  testID?: string;
}) {
  const withWhom = companions.length > 0 ? `with ${companions.map((name) => `@${name}`).join(', ')}` : null;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={['Cook Log', day, withWhom].filter(Boolean).join(', ')}
      disabled={!onPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.heading}>
          <Text variant="headline">{day}</Text>
          {withWhom ? (
            <Text variant="caption" tone="textMuted" numberOfLines={1}>
              {withWhom}
            </Text>
          ) : null}
        </View>
        {onPress ? <Icon name="chevron-forward" tone="textMuted" /> : null}
      </View>
      {notes ? <Text numberOfLines={4}>{notes}</Text> : null}
      {photos.length > 0 ? <PhotoStrip photos={photos} size="sm" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heading: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.7 },
});
