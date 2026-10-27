import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useContext, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutRectangle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { scrollBar, scrollPhase, type ScrollPhase } from './scroll-phase';
import { Text } from './text';
import { colors, hairline, spacing } from './theme';

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
   * navigation header above it. Without a header, the content also leaves room for a compact bar
   * of the Screen's own, so it works under a header as well as without one.
   */
  scroll?: boolean;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // Inside the tab bar, the bar already sits above the home indicator.
  const inTabs = useContext(BottomTabBarHeightContext) !== undefined;
  const bar = scrollBar({ headerHeight: useContext(HeaderHeightContext) ?? 0, safeTop: insets.top });
  const [titleFrame, setTitleFrame] = useState<LayoutRectangle | null>(null);
  const [phase, setPhase] = useState<ScrollPhase>('top');

  const heading = title ? (
    <Text
      variant="largeTitle"
      accessibilityRole="header"
      style={styles.title}
      onLayout={(e) => setTitleFrame(e.nativeEvent.layout)}>
      {title}
    </Text>
  ) : null;

  if (scroll) {
    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const titleBottom = titleFrame ? titleFrame.y + titleFrame.height : null;
      setPhase(scrollPhase(e.nativeEvent.contentOffset.y, bar, titleBottom));
    };
    return (
      <View style={styles.fill}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.content, { paddingTop: spacing.sm + bar.reserved }]}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}>
          {heading}
          {children}
        </ScrollView>
        {phase === 'top' ? null : (
          <CompactBar
            height={bar.height}
            top={insets.top}
            title={phase === 'compact' ? title : undefined}
          />
        )}
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

/**
 * The bar over a scrolled screen: a background behind the status bar and the navigation header's
 * floating buttons, so content doesn't slide under them bare, and the screen's title once its large
 * title has scrolled away, as a native compact navigation title does.
 */
function CompactBar({ height, top, title }: { height: number; top: number; title?: string }) {
  return (
    <View pointerEvents="none" testID="screen-bar" style={[styles.bar, { height, paddingTop: top }]}>
      {title ? (
        <Text
          variant="headline"
          numberOfLines={1}
          testID="screen-compact-title"
          style={styles.compactTitle}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  // Clear of the back button on the left and anything mirrored on the right.
  compactTitle: { textAlign: 'center', paddingHorizontal: spacing.xxl * 2 },
  fill: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: { paddingTop: spacing.sm },
});
