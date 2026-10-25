import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { colors, radii, spacing, typography } from './theme';

/**
 * A gray rounded field for adding one thing by name, with an Add button at its right. Return also
 * adds. The button is dimmed while the field is blank.
 *
 * The field holds its own text and clears as soon as it's submitted, so the next name can be typed
 * while the last one is still saving.
 */
export function AddField({
  onSubmit,
  placeholder,
  submitLabel = 'Add',
  accessibilityLabel,
  testID,
}: {
  /**
   * Saves the submitted name. If the promise rejects, the name comes back into the field unless
   * something new has been typed there; showing the error is up to the screen.
   */
  onSubmit: (text: string) => Promise<unknown>;
  placeholder: string;
  submitLabel?: string;
  /** Defaults to the placeholder. The button is labelled `${submitLabel}: ${accessibilityLabel}`. */
  accessibilityLabel?: string;
  testID?: string;
}) {
  const label = accessibilityLabel ?? placeholder;
  const [value, setValue] = useState('');
  const blank = value.trim() === '';
  const submit = () => {
    if (blank) return;
    const text = value;
    setValue('');
    onSubmit(text).catch(() => setValue((current) => (current === '' ? text : current)));
  };
  return (
    <View style={styles.field}>
      <Icon name="add-circle-outline" tone="textMuted" />
      <TextInput
        value={value}
        onChangeText={setValue}
        onSubmitEditing={submit}
        submitBehavior="submit"
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        returnKeyType="done"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${submitLabel}: ${label}`}
        accessibilityState={{ disabled: blank }}
        disabled={blank}
        hitSlop={spacing.sm}
        onPress={submit}
        testID={testID ? `${testID}-submit` : undefined}
        style={({ pressed }) => (pressed || blank) && styles.dimmed}>
        <Text variant="headline" tone="accent">
          {submitLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  // TextInput ignores lineHeight on iOS when it's set, so only size and colour come from the scale.
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: colors.text,
    paddingVertical: 0,
  },
  dimmed: { opacity: 0.4 },
});
