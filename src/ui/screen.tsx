import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from './text';
import { colors, spacing } from './theme';

/**
 * A full screen: safe area, background, and an optional large title. Inside the tab bar the bottom
 * inset is already taken by the bar, so the safe area adds nothing there.
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
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          {heading}
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.fill}>
      <View style={[styles.content, styles.grow]}>
        {heading}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  grow: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: { paddingTop: spacing.sm },
});
