import { StyleSheet, TextInput, View } from 'react-native';

import { Text } from './text';
import { colors, radii, spacing, typography } from './theme';

/** A small label over a gray rounded input. `multiline` grows with its text. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  autoCapitalize = 'sentences',
  accessibilityLabel,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  /** Defaults to the label. Set it when several fields share a label ("Amount 2"). */
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text variant="label" tone="textMuted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, gap: spacing.xs },
  // TextInput ignores lineHeight on iOS when it's set, so only size and colour come from the scale.
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    fontSize: typography.body.fontSize,
    color: colors.text,
  },
  multiline: { minHeight: 72, paddingTop: spacing.md, textAlignVertical: 'top' },
});
