import { StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, radii, spacing } from './theme';

/** A step's number in a small round badge. */
export function StepNumber({ number }: { number: number }) {
  return (
    <View style={styles.badge}>
      <Text variant="label">{String(number)}</Text>
    </View>
  );
}

/** One numbered step of a Recipe's method. */
export function StepRow({ number, text }: { number: number; text: string }) {
  return (
    <View accessible accessibilityLabel={`Step ${number}. ${text}`} style={styles.row}>
      <StepNumber number={number} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  badge: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
});
