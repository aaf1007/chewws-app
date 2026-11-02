import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/** One picture in a strip: shown from `uri` (null: no link to it right now, a gray square). */
export type StripPhoto = { key: string; uri: string | null };

/**
 * A sideways row of square photos (a Cook Log's). Editable, each has a round × at its corner
 * ("Remove photo 2"), and an outlined "Add photo" tile follows while there's room for more.
 */
export function PhotoStrip({
  photos,
  size = 'md',
  onRemove,
  onAdd,
  max,
  adding = false,
  disabled = false,
}: {
  photos: readonly StripPhoto[];
  /** `sm` on a card that lists them, `md` in a form. */
  size?: 'sm' | 'md';
  onRemove?: (key: string) => void;
  /** Shows the "Add photo" tile while there are fewer than `max`. */
  onAdd?: () => void;
  max?: number;
  /** The picker is open, or the picture is being scaled down. */
  adding?: boolean;
  disabled?: boolean;
}) {
  const side = size === 'sm' ? SMALL : MEDIUM;
  const square = { width: side, height: side };
  const canAdd = onAdd !== undefined && (max === undefined || photos.length < max);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {photos.map((photo, i) => (
        <View key={photo.key} style={square}>
          {photo.uri ? (
            <Image
              source={{ uri: photo.uri }}
              style={[styles.photo, square]}
              accessible
              accessibilityLabel={`Photo ${i + 1}`}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.photo, styles.placeholder, square]} accessible accessibilityLabel={`Photo ${i + 1}`}>
              <Icon name="image-outline" tone="textMuted" />
            </View>
          )}
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${i + 1}`}
              disabled={disabled}
              hitSlop={spacing.sm}
              onPress={() => onRemove(photo.key)}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
              <Icon name="close" size="sm" tone="onAccent" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={adding ? 'Adding photo…' : 'Add photo'}
          accessibilityState={{ disabled: disabled || adding }}
          disabled={disabled || adding}
          onPress={onAdd}
          testID="add-photo"
          style={({ pressed }) => [styles.photo, styles.add, square, pressed && styles.pressed]}>
          <Icon name="camera-outline" tone="accent" />
          <Text variant="caption" tone="accent">
            {adding ? 'Adding…' : 'Add photo'}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const SMALL = 64;
const MEDIUM = 88;

const styles = StyleSheet.create({
  row: { gap: spacing.sm },
  photo: { borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  add: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  remove: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  pressed: { opacity: 0.6 },
});
