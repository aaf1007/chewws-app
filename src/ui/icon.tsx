import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { colors, iconSize, type ColorRole } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({
  name,
  size = 'md',
  tone = 'text',
}: {
  name: IconName;
  size?: keyof typeof iconSize;
  tone?: ColorRole;
}) {
  // Decorative: the glyph is a private-use character, so keep it out of accessibility labels.
  return (
    <Ionicons
      name={name}
      size={iconSize[size]}
      color={colors[tone]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
