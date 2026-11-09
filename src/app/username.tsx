import { router, useLocalSearchParams } from 'expo-router';

import { UsernameForm } from '@/components/username-form';
import { Screen, Text } from '@/ui';

/** Changes the user's username, from Profile. The old one is free for anyone at once. */
export default function ChangeUsername() {
  const { current } = useLocalSearchParams<{ current?: string }>();
  return (
    <Screen title="Change username" scroll>
      <Text tone="textMuted">Your Friends stay your Friends. Your old username is free for anyone to take.</Text>
      <UsernameForm initial={current ?? ''} submitLabel="Save" onSet={() => router.back()} />
    </Screen>
  );
}
