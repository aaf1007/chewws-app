import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import { useWhileFocused } from '@/components/use-while-focused';
import { data } from '@/data/app';
import { Button, NavRow, Screen, SectionHeader, Text, spacing } from '@/ui';

async function loadProfile() {
  const [profile, requests] = await Promise.all([data.getMyProfile(), data.listFriendRequests()]);
  return { username: profile.username, waiting: requests.incoming.length };
}

const requestsDetail = (waiting: number) =>
  waiting === 0 ? 'Find people by username' : waiting === 1 ? '1 request' : `${waiting} requests`;

export default function Profile() {
  const [error, setError] = useState<string | null>(null);
  const [state] = useWhileFocused(loadProfile);
  const profile = state.status === 'loaded' ? state.value : null;

  return (
    <Screen title="Profile">
      {profile?.username ? (
        <Text variant="title" testID="profile-username">
          @{profile.username}
        </Text>
      ) : null}
      {state.status === 'error' ? <Text tone="danger">{state.message}</Text> : null}

      <View>
        <NavRow
          icon="people-outline"
          label="Friends"
          detail={profile ? requestsDetail(profile.waiting) : undefined}
          onPress={() => router.push('/friends')}
          testID="friends-row"
        />
        <NavRow
          icon="at-outline"
          label="Change username"
          onPress={() => router.push({ pathname: '/username', params: { current: profile?.username ?? '' } })}
        />
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Account" />
        {/* In the screen body, not the header: the dev client's floating tools button starts over
            the header's right-hand corner and took the first tap on a header button there. */}
        <Button
          label="Sign out"
          variant="outlined"
          icon="log-out-outline"
          onPress={() => {
            setError(null);
            data.signOut().catch((e: unknown) => setError(messageOf(e)));
          }}
        />
        {error ? <Text tone="danger">{error}</Text> : null}
      </View>

      {__DEV__ ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Developer" />
          <Button
            label="UI gallery (dev)"
            variant="plain"
            icon="color-palette-outline"
            onPress={() => router.push('/dev/ui')}
          />
        </View>
      ) : null}
    </Screen>
  );
}
