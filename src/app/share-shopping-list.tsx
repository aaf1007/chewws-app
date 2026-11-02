import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { useWhileFocused } from '@/components/use-while-focused';
import type { Friend } from '@/data';
import { data } from '@/data/app';
import { EmptyState, NavRow, PersonRow, Screen, SectionHeader, Text, spacing } from '@/ui';

async function loadFriendsAndShares() {
  const [friends, shares] = await Promise.all([data.listFriends(), data.listShoppingListShares()]);
  return { friends, sharedWith: new Set(shares.map((share) => share.friend.id)) };
}

/**
 * Share your Shopping List, from the Shopping List tab: each Friend with "Share", or "Stop sharing"
 * for those it's shared with. Friends it's shared with see it change live, add to it and check
 * things off; what they check off goes in your Pantry (decisions 13).
 */
export default function ShareShoppingList() {
  const [state, reload] = useWhileFocused(loadFriendsAndShares);
  const [error, setError] = useState<string | null>(null);

  /** Runs a change, then shows who it's shared with now. */
  const change = (run: () => Promise<string | null>) => () => {
    setError(null);
    run()
      .then((message) => message && setError(message))
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(reload);
  };

  const row = (friend: Friend, shared: boolean) => (
    <PersonRow
      key={friend.id}
      username={friend.username}
      detail={shared ? 'Sees your list and can change it' : undefined}
      actions={[
        shared
          ? {
              label: 'Stop sharing',
              tone: 'muted',
              onPress: change(async () => {
                await data.stopSharingShoppingList(friend.id);
                return null;
              }),
            }
          : {
              label: 'Share',
              onPress: change(async () =>
                (await data.shareShoppingList(friend.id)).status === 'notFriends'
                  ? `You and @${friend.username} aren't Friends any more.`
                  : null,
              ),
            },
      ]}
    />
  );

  const loaded = state.status === 'loaded' ? state.value : null;
  return (
    <Screen title="Share your list" scroll>
      <Text tone="textMuted">
        Friends you share your Shopping List with see it change as it happens, and can add to it and check things off.
        What they check off goes in your Pantry.
      </Text>
      {error ? <Text tone="danger">{error}</Text> : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {loaded && loaded.friends.length === 0 ? (
        <View style={{ gap: spacing.lg }}>
          <EmptyState
            icon="people-outline"
            title="No Friends yet"
            message="You can share your list with Friends. Find them by username first."
          />
          <NavRow icon="people-outline" label="Friends" detail="Find and add Friends" onPress={() => router.push('/friends')} />
        </View>
      ) : null}
      {loaded && loaded.friends.length > 0 ? (
        <View testID="share-friends">
          <SectionHeader title="Friends" />
          {loaded.friends.map((friend) => row(friend, loaded.sharedWith.has(friend.id)))}
        </View>
      ) : null}
    </Screen>
  );
}
