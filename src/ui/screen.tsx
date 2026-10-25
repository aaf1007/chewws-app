import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { useContext, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './text';
import { colors, spacing } from './theme';

/**
 * A full screen: safe area, background, and an optional large title.
 *
 * The insets come from the safe-area provider, which knows them before the first frame, rather than
 * from <SafeAreaView>, which measures natively after mounting: that drew every screen 62pt too high
 * for a frame and then jumped, and a tap aimed in that frame missed its target.
 */
export function Screen({
  title,
  scroll = false,
  children,
}: {
  /** Large, bold, left-aligned title at the top of the content. */
  title?: string;
  /**
   * Scroll the content (title included). The scroll view insets itself for the safe area and any
   * navigation header above it, so it works under a header as well as without one.
   */
  scroll?: boolean;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // Inside the tab bar, the bar already sits above the home indicator.
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;

  const heading = title ? (
    <Text variant="largeTitle" accessibilityRole="header" style={styles.title}>
      {title}
    </Text>
  ) : null;

  if (scroll) {
    return (
      <View style={styles.fill}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          {heading}
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.fill,
        {
          paddingTop: insets.top,
          paddingBottom: inTabs ? 0 : insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}>
      <View style={[styles.content, styles.fill]}>
        {heading}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: { paddingTop: spacing.sm },
});
