import { StyleSheet, View } from 'react-native';

import { Text } from './text';
import { colors, radii, typography, type ColorRole } from './theme';

/** Whose Score it is: the user's own (accent) or their Friends' (friend accent). */
export type ScoreTone = 'mine' | 'friend';

const FILL: Record<ScoreTone, ColorRole> = { mine: 'accent', friend: 'friendAccent' };
const DIAMETER = { sm: 32, md: 44 } as const;

/** Formats a 0–10 Score with one decimal, clamping anything outside the range. */
export function formatScore(score: number): string {
  return Math.min(10, Math.max(0, score)).toFixed(1);
}

export function ScoreBadge({
  score,
  tone,
  size = 'md',
}: {
  score: number;
  tone: ScoreTone;
  size?: keyof typeof DIAMETER;
}) {
  const label = formatScore(score);
  const d = DIAMETER[size];
  return (
    <View
      accessible
      accessibilityLabel={`${tone === 'mine' ? 'Score' : 'Friends’ Score'} ${label}`}
      style={[
        styles.badge,
        { width: d, height: d, backgroundColor: colors[FILL[tone]] },
      ]}>
      <Text
        variant={size === 'sm' ? 'label' : 'headline'}
        tone="onAccent"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        allowFontScaling={false}
        style={[styles.number, size === 'sm' && styles.small]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontWeight: '700', paddingHorizontal: 3 },
  // The small badge sits on a 56pt thumbnail; tighten the label so "10.0" still fits on one line.
  small: { letterSpacing: -0.4, lineHeight: typography.label.fontSize },
});
