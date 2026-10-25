import Ionicons from '@expo/vector-icons/Ionicons';
import type { TabsScreenOptions } from 'expo-router/js-tabs';

import type { IconName } from './icon';
import { colors, hairline, iconSize, typography } from './theme';

/** Screen options for the signed-in tab bar: icon over a small label, active tab in the accent. */
export const tabScreenOptions: TabsScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarLabelStyle: typography.tabLabel,
  tabBarStyle: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: hairline,
  },
  sceneStyle: { backgroundColor: colors.background },
};

/** A tab's icon: the filled glyph when the tab is active, the outline otherwise. */
export function tabIcon(active: IconName, inactive: IconName) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return (
      <Ionicons
        name={focused ? active : inactive}
        size={iconSize.lg}
        color={focused ? colors.accent : colors.textMuted}
      />
    );
  };
}
