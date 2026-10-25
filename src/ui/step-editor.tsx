import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { StepNumber } from './step-row';
import { TextField } from './text-field';
import { spacing } from './theme';

/** One step being written: its number, a growing text field and a remove button. */
export function StepEditor({
  number,
  value,
  onChange,
  onRemove,
}: {
  /** 1-based. */
  number: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.number}>
        <StepNumber number={number} />
      </View>
      <TextField
        label={`Step ${number}`}
        value={value}
        onChangeText={onChange}
        placeholder="What to do"
        multiline
        testID={`step-${number}`}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove step ${number}`}
        hitSlop={spacing.sm}
        onPress={onRemove}
        style={styles.remove}>
        <Icon name="trash-outline" size="sm" tone="textMuted" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  number: { paddingTop: spacing.xl },
  remove: { paddingTop: spacing.xl + spacing.sm },
});
