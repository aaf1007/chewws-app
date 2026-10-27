import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography, type ColorRole, type TypeVariant } from './theme';

export type TextProps = RNTextProps & {
  /** A step of the type scale. There is no free font size. */
  variant?: TypeVariant;
  /** A colour role. Defaults to `text`. */
  tone?: ColorRole;
};

export function Text({ variant = 'body', tone = 'text', style, ...rest }: TextProps) {
  return <RNText {...rest} style={[typography[variant], { color: colors[tone] }, style]} />;
}
