import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, tabScreenOptions, type IconName } from '@/ui';

// The test id lets e2e flows tap a tab by name; its accessibility label also says "tab, 2 of 5".
const tab = (title: string, testId: string, active: IconName, inactive: IconName) => ({
  title,
  tabBarButtonTestID: `tab-${testId}`,
  tabBarIcon: tabIcon(active, inactive),
});

export default function SignedInTabs() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={tab('Library', 'library', 'book', 'book-outline')} />
      <Tabs.Screen name="pantry" options={tab('Pantry', 'pantry', 'basket', 'basket-outline')} />
      {/* "Shopping", as "Shopping List" doesn't fit beside four other tabs. */}
      <Tabs.Screen name="shopping-list" options={tab('Shopping', 'shopping-list', 'cart', 'cart-outline')} />
      <Tabs.Screen name="cook-plans" options={tab('Cook Plans', 'cook-plans', 'restaurant', 'restaurant-outline')} />
      <Tabs.Screen name="profile" options={tab('Profile', 'profile', 'person', 'person-outline')} />
    </Tabs>
  );
}
