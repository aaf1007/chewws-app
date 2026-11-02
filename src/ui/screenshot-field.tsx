import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Button } from './button';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/**
 * A screenshot the user adds to a link (an Instagram Reel's caption, say): a small label over an
 * "Add screenshot" button, or, once one is added, its picture beside "Change" and "Remove".
 */
export function ScreenshotField({
  label = 'Screenshot',
  imageUri,
  onAdd,
  onRemove,
  adding = false,
  disabled = false,
}: {
  label?: string;
  /** The added screenshot, on the phone; null for none yet. */
  imageUri: string | null;
  onAdd: () => void;
  onRemove: () => void;
  /** The picker is open, or the picture is being scaled down. */
  adding?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text variant="label" tone="textMuted">
        {label}
      </Text>
      {imageUri ? (
        <View style={styles.added}>
          <Image
            source={{ uri: imageUri }}
            style={styles.thumb}
            accessible
            accessibilityLabel="Screenshot added"
            accessibilityIgnoresInvertColors
            testID="screenshot-preview"
          />
          <View style={styles.actions}>
            {[
              { label: 'Change screenshot', text: 'Change', onPress: onAdd },
              { label: 'Remove screenshot', text: 'Remove', onPress: onRemove },
            ].map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: disabled || adding }}
                disabled={disabled || adding}
                hitSlop={spacing.sm}
                onPress={action.onPress}>
                <Text variant="label" tone={action.text === 'Remove' ? 'danger' : 'accent'}>
                  {action.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <Button
          label={adding ? 'Adding screenshot…' : 'Add screenshot'}
          icon="image-outline"
          variant="outlined"
          disabled={disabled || adding}
          onPress={onAdd}
          testID="add-screenshot"
        />
      )}
    </View>
  );
}

const THUMB_WIDTH = 72;

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  added: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: (THUMB_WIDTH * 4) / 3,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
  },
  actions: { flex: 1, flexDirection: 'row', gap: spacing.lg },
});
