import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { useWhileFocused } from '@/components/use-while-focused';
import type { UserId } from '@/data';
import { data } from '@/data/app';
import { Button, DayPicker, EmptyState, NavRow, PersonRow, Screen, SectionHeader, Text, spacing } from '@/ui';

/**
 * Start a Cook Plan (decisions 14): an optional day, and the Friends to invite. Only Friends can be
 * invited; each is in the plan at once and gets a push. More can be invited later.
 */
export default function NewCookPlan() {
  const [friends] = useWhileFocused(() => data.listFriends());
  const [cookOn, setCookOn] = useState<string | null>(null);
  const [invited, setInvited] = useState<ReadonlySet<UserId>>(new Set());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: UserId) =>
    setInvited((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const start = () => {
    setError(null);
    setStarting(true);
    data
      .createCookPlan({ cookOn, friends: [...invited] })
      .then(({ planId }) => router.replace({ pathname: '/cook-plan/[id]', params: { id: planId } }))
      .catch((e: unknown) => {
        setError(messageOf(e));
        setStarting(false);
      });
  };

  const loaded = friends.status === 'loaded' ? friends.value : null;
  return (
    <Screen title="New Cook Plan" scroll>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="When" />
        <DayPicker value={cookOn} onChange={setCookOn} testID="cook-plan-day" />
      </View>

      <View>
        <SectionHeader title="Invite Friends" />
        {friends.status === 'error' ? <Text tone="danger">{friends.message}</Text> : null}
        {loaded && loaded.length === 0 ? (
          <View style={{ gap: spacing.lg }}>
            <EmptyState
              icon="people-outline"
              title="No Friends yet"
              message="You can start a Cook Plan now and invite Friends once you've added them."
            />
            <NavRow icon="people-outline" label="Friends" detail="Find and add Friends" onPress={() => router.push('/friends')} />
          </View>
        ) : null}
        {loaded?.map((friend) => {
          const picked = invited.has(friend.id);
          return (
            <PersonRow
              key={friend.id}
              username={friend.username}
              detail={picked ? 'Invited when you start' : undefined}
              actions={[picked ? { label: 'Remove', tone: 'muted', onPress: () => toggle(friend.id) } : { label: 'Invite', onPress: () => toggle(friend.id) }]}
            />
          );
        })}
      </View>

      {error ? <Text tone="danger">{error}</Text> : null}
      <Button label="Start Cook Plan" icon="restaurant-outline" disabled={starting} onPress={start} testID="create-cook-plan" />
    </Screen>
  );
}
