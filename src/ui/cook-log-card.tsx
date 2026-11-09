import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { PhotoStrip, type StripPhoto } from './photo-strip';
import { Text } from './text';
import { colors, hairline, spacing } from './theme';

/**
 * One time a Recipe was cooked, as a row in its list of Cook Logs: the day in bold ("Sat 2 Nov"),
 * who it was cooked with ("with @sam, @jo"), the notes and the photos. Pressing it opens the log.
 * In a list of someone's Cook Logs of many Recipes, `recipe` (its title) is the bold line, with the
 * day under it ("Sat 2 Nov · with @jo"). It's one element to VoiceOver (and Maestro), so its label
 * carries the notes too.
 */
export function CookLogCard({
  day,
  recipe,
  companions,
  notes,
  photos,
  onPress,
  testID,
}: {
  /** The day as the app writes it (`formatDay`). */
  day: string;
  /** The Recipe's title, when the list holds logs of more than one Recipe. */
  recipe?: string;
  /** Usernames, without the @. */
  companions: readonly string[];
  notes: string | null;
  photos: readonly StripPhoto[];
  onPress?: () => void;
  testID?: string;
}) {
  const withWhom = companions.length > 0 ? `with ${companions.map((name) => `@${name}`).join(', ')}` : null;
  const under = recipe === undefined ? withWhom : [day, withWhom].filter(Boolean).join(' · ');
  const heading = ['Cook Log', recipe, day, withWhom].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={notes ? `${heading}. ${notes}` : heading}
      disabled={!onPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.heading}>
          <Text variant="headline" numberOfLines={recipe === undefined ? undefined : 1}>
            {recipe ?? day}
          </Text>
          {under ? (
            <Text variant="caption" tone="textMuted" numberOfLines={1}>
              {under}
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
