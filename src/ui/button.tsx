import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Text } from './text';
import { colors, radii, spacing, type ColorRole } from './theme';

/** `danger` is a plain button for destructive actions, such as deleting a Recipe. */
export type ButtonVariant = 'filled' | 'outlined' | 'plain' | 'danger';

const LABEL_TONE: Record<ButtonVariant, ColorRole> = {
  filled: 'onAccent',
  outlined: 'text',
  plain: 'accent',
  danger: 'danger',
};

export function Button({
  label,
  onPress,
  variant = 'filled',
  icon,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  testID?: string;
}) {
  const tone = LABEL_TONE[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        (pressed || disabled) && styles.dimmed,
      ]}>
      <View style={styles.content}>
        {icon ? <Icon name={icon} tone={tone} /> : null}
        <Text variant="headline" tone={tone}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  filled: { backgroundColor: colors.accent },
  outlined: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  plain: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent' },
  dimmed: { opacity: 0.6 },
});
