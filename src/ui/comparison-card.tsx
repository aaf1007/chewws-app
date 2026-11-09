import { StyleSheet, View } from 'react-native';

import { Button } from './button';
import { Text } from './text';
import { colors, radii, spacing } from './theme';

/**
 * One ranking comparison: a bordered card asking "Better or worse than" over the other Recipe's
 * title, with "Better" (filled) and "Worse" (outlined) side by side. `step` is a muted line under
 * the title ("Comparison 2").
 */
export function ComparisonCard({
  title,
  step,
  onBetter,
  onWorse,
  disabled = false,
}: {
  title: string;
  step?: string;
  onBetter: () => void;
  onWorse: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.card} testID="comparison-card">
      <View style={styles.question} accessible accessibilityLabel={`Better or worse than ${title}?`}>
        <Text variant="overline" tone="textMuted">
          Better or worse than
        </Text>
        <Text variant="title" style={styles.center}>
          {title}
        </Text>
        {step ? (
          <Text variant="caption" tone="textMuted">
            {step}
          </Text>
        ) : null}
      </View>
      <View style={styles.answers}>
        <View style={styles.answer}>
          <Button label="Better" icon="arrow-up" disabled={disabled} onPress={onBetter} testID="answer-better" />
        </View>
        <View style={styles.answer}>
          <Button label="Worse" variant="outlined" icon="arrow-down" disabled={disabled} onPress={onWorse} testID="answer-worse" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  question: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  center: { textAlign: 'center' },
  answers: { flexDirection: 'row', gap: spacing.sm },
  answer: { flex: 1 },
});
