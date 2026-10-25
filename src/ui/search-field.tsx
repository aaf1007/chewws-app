import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from './icon';
import { colors, radii, spacing, typography } from './theme';

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  onFilterPress,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Shows a filter button at the right. */
  onFilterPress?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Icon name="search" tone="textMuted" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={styles.input}
      />
      {onFilterPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          hitSlop={spacing.sm}
          onPress={onFilterPress}>
          <Icon name="options-outline" tone="text" />
        </Pressable>
      ) : null}
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
});
