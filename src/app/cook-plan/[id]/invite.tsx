import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { useWhileFocused } from '@/components/use-while-focused';
import { parseCookPlanId, type Friend, type InviteToCookPlanResult } from '@/data';
import { data } from '@/data/app';
import { EmptyState, NavRow, PersonRow, Screen, SectionHeader, Text, spacing } from '@/ui';

async function loadInvitable(rawId: string) {
  const planId = parseCookPlanId(rawId);
  const [plan, friends] = await Promise.all([data.getCookPlan(planId), data.listFriends()]);
  const inPlan = new Set(plan?.members.map((m) => m.id) ?? []);
  return { planId, friends: friends.filter((f) => !inPlan.has(f.id)) };
}

/** Why an invite didn't go through, as the screen says it. */
function refusal(status: InviteToCookPlanResult['status'], friend: Friend): string | null {
  switch (status) {
    case 'invited':
    case 'alreadyMember':
      return null;
    case 'notFriends':
      return `You and @${friend.username} aren't Friends any more.`;
    case 'full':
      return 'A Cook Plan holds 8 people, and this one is full.';
    case 'notActive':
      return 'This Cook Plan has been cooked; nobody new can join.';
    case 'notFound':
      return 'You’re not in this Cook Plan any more.';
  }
}

/** Invite more of your Friends into a Cook Plan: each is in it at once, and gets a push. */
export default function InviteToCookPlan() {
  const rawId = useLocalSearchParams<{ id: string }>().id;
  const [state, reload] = useWhileFocused(() => loadInvitable(rawId));
  const [error, setError] = useState<string | null>(null);

  const invite = (planId: Parameters<typeof data.inviteToCookPlan>[0], friend: Friend) => () => {
    setError(null);
    data
      .inviteToCookPlan(planId, friend.id)
      .then(({ status }) => setError(refusal(status, friend)))
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(reload);
  };

  const loaded = state.status === 'loaded' ? state.value : null;
  return (
    <Screen title="Invite Friends" scroll>
      <Text tone="textMuted">Friends you invite are in the plan at once. They see its Recipes and can add their own.</Text>
      {error ? <Text tone="danger">{error}</Text> : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}
      {loaded && loaded.friends.length === 0 ? (
        <View style={{ gap: spacing.lg }}>
          <EmptyState icon="people-outline" title="Nobody else to invite" message="Every Friend of yours is in this plan already." />
          <NavRow icon="people-outline" label="Friends" detail="Find and add Friends" onPress={() => router.push('/friends')} />
        </View>
      ) : null}
      {loaded && loaded.friends.length > 0 ? (
        <View testID="invite-friends">
          <SectionHeader title="Friends" />
          {loaded.friends.map((friend) => (
            <PersonRow key={friend.id} username={friend.username} actions={[{ label: 'Invite', onPress: invite(loaded.planId, friend) }]} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
