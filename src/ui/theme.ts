import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

// Light mode only for now: every screen draws on `background`, whatever the system appearance.

/** Colours by role. Screens and components name a role, never a hex value. */
export const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F2F4',
  text: '#141414',
  textMuted: '#6E6E73',
  border: '#E3E3E8',
  accent: '#D83E0E',
  onAccent: '#FFFFFF',
  friendAccent: '#5B5BD6',
  danger: '#C62828',
} as const;

export type ColorRole = keyof typeof colors;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  sheet: 24,
  pill: 999,
} as const;

/** iOS text styles, drawn in the system font. */
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tabLabel: { fontSize: 11, lineHeight: 13, fontWeight: '600' },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typography;

export const hairline = StyleSheet.hairlineWidth;

/** For elements that float over content: the segmented pill, buttons over a photo. */
export const floatingShadow = {
  boxShadow: '0px 4px 16px rgba(0, 0, 0, 0.12)',
} as const satisfies ViewStyle;

/** Icon sizes, matched to the type scale. */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 40,
} as const;
